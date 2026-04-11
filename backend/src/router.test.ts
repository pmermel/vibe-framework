import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { router } from "./router.js";

// Mock MCP server so these tests don't spin up real transport
vi.mock("./lib/mcp-server.js", () => ({
  createMcpServer: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  }),
}));
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    sessionId: undefined,
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    start: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    // Send a minimal JSON-RPC response so supertest requests that reach the
    // transport (i.e. those that pass auth) don't hang waiting for a response.
    handleRequest: vi.fn().mockImplementation((_req: unknown, res: { json: (b: unknown) => void; headersSent?: boolean }) => {
      if (!res.headersSent) {
        res.json({ jsonrpc: "2.0", id: 1, result: {} });
      }
      return Promise.resolve(undefined);
    }),
  })),
}));
vi.mock("./handler.js", () => ({
  handleAction: vi.fn((_req, res) => res.json({ ok: true })),
}));

/**
 * Single shared express app for all router tests.
 *
 * isDevMode() and MCP_API_KEY are both read at request time in router.ts,
 * so tests can set process.env vars directly before each request without
 * reloading the module. This eliminates vi.resetModules() and the per-test
 * TCP listener that the old buildApp() pattern required.
 */
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(router);

describe("router — OAuth token endpoints", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.MCP_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.MCP_API_KEY = originalKey;
  });

  it("POST /oauth/token returns a token in dev mode (no MCP_API_KEY)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.MCP_API_KEY;
    const res = await request(app).post("/oauth/token").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer" });
    expect(res.body.access_token).toBeDefined();
  });

  it("POST /oauth/token returns 501 in production mode", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_API_KEY;
    const res = await request(app).post("/oauth/token").send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("POST /oauth/token returns 501 in dev mode when MCP_API_KEY is set", async () => {
    process.env.NODE_ENV = "development";
    process.env.MCP_API_KEY = "test-key";
    const res = await request(app).post("/oauth/token").send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("GET /oauth/authorize returns 501 in production mode", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_API_KEY;
    const res = await request(app).get("/oauth/authorize?redirect_uri=https://example.com/cb");
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("GET /oauth/authorize redirects in dev mode (no MCP_API_KEY)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.MCP_API_KEY;
    const res = await request(app)
      .get("/oauth/authorize?redirect_uri=https://example.com/cb&state=xyz")
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("code=vibe-dev-code");
    expect(res.headers.location).toContain("state=xyz");
  });
});

describe("router — OAuth discovery metadata", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it("GET /.well-known/oauth-protected-resource is always available", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app).get("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("resource");
    expect(res.body).toHaveProperty("authorization_servers");
  });

  it("GET /.well-known/oauth-authorization-server is always available", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token_endpoint");
    expect(res.body).toHaveProperty("authorization_endpoint");
  });

  it("GET /.well-known/oauth-authorization-server respects forwarded https", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .set("Host", "tough-hornets-build.loca.lt")
      .set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe("https://tough-hornets-build.loca.lt");
    expect(res.body.authorization_endpoint).toBe(
      "https://tough-hornets-build.loca.lt/oauth/authorize"
    );
    expect(res.body.token_endpoint).toBe(
      "https://tough-hornets-build.loca.lt/oauth/token"
    );
  });
});

describe("router — /mcp auth gate (no MCP_API_KEY)", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.MCP_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.MCP_API_KEY = originalKey;
  });

  it("POST /mcp returns 501 in production when MCP_API_KEY is not set", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_API_KEY;
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("POST /mcp returns 501 in production even with a Bearer token when MCP_API_KEY is not set", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MCP_API_KEY;
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer some-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });
});

describe("router — /mcp Bearer token auth (MCP_API_KEY set)", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalKey = process.env.MCP_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.MCP_API_KEY = originalKey;
  });

  it("POST /mcp returns 401 in production when no Authorization header is sent", async () => {
    process.env.NODE_ENV = "production";
    process.env.MCP_API_KEY = "test-secret-key";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("POST /mcp returns 401 in production when Bearer token is wrong", async () => {
    process.env.NODE_ENV = "production";
    process.env.MCP_API_KEY = "test-secret-key";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer wrong-key")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("POST /mcp passes auth gate in production with correct Bearer token", async () => {
    process.env.NODE_ENV = "production";
    process.env.MCP_API_KEY = "test-secret-key";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer test-secret-key")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).not.toBe(501);
    expect(res.status).not.toBe(401);
  });

  it("POST /mcp returns 401 in dev mode when MCP_API_KEY is set and no token provided", async () => {
    process.env.NODE_ENV = "development";
    process.env.MCP_API_KEY = "test-secret-key";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("POST /mcp passes in dev mode with correct Bearer token when MCP_API_KEY is set", async () => {
    process.env.NODE_ENV = "development";
    process.env.MCP_API_KEY = "test-secret-key";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer test-secret-key")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(501);
  });
});
