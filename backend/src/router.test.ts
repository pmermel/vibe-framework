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
    handleRequest: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("./handler.js", () => ({
  handleAction: vi.fn((_req, res) => res.json({ ok: true })),
}));

/**
 * Single shared express app for all router tests.
 *
 * isDevMode() in router.ts reads process.env.NODE_ENV at request time
 * (not module load), so tests can change the env var per-test without
 * reloading the module. This eliminates vi.resetModules() and the
 * per-test TCP listener that the old buildApp() pattern required.
 */
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(router);

describe("router — OAuth token endpoints", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("POST /oauth/token returns a token in dev mode", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app).post("/oauth/token").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "Bearer" });
    expect(res.body.access_token).toBeDefined();
  });

  it("POST /oauth/token returns 501 in production mode", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app).post("/oauth/token").send({});
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("GET /oauth/authorize returns 501 in production mode", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app).get("/oauth/authorize?redirect_uri=https://example.com/cb");
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("GET /oauth/authorize redirects in dev mode", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app)
      .get("/oauth/authorize?redirect_uri=https://example.com/cb&state=xyz")
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("code=vibe-dev-code");
    expect(res.headers.location).toContain("state=xyz");
  });
});

describe("router — OAuth discovery metadata", () => {
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

describe("router — /mcp auth gate", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("POST /mcp returns 501 in production (disabled until real auth is implemented)", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });

  it("POST /mcp returns 501 in production even with a Bearer token present", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer some-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
  });
});
