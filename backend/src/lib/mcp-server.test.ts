import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, TOOLS } from "./mcp-server.js";
import { postStatus } from "../actions/post-status.js";

// Mock all action modules so tests never make real API calls
vi.mock("../actions/bootstrap-framework.js", () => ({
  bootstrapFramework: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/create-project.js", () => ({
  createProject: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/import-project.js", () => ({
  importProject: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/configure-repo.js", () => ({
  configureRepo: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/configure-cloud.js", () => ({
  configureCloud: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/generate-assets.js", () => ({
  generateAssets: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/capture-preview.js", () => ({
  capturePreview: vi.fn().mockResolvedValue({ status: "not_implemented" }),
}));
vi.mock("../actions/post-status.js", () => ({
  postStatus: vi.fn().mockResolvedValue({
    github_repo: "owner/repo",
    pr_number: 1,
    status: "pending",
    posted: false,
    comment_body: "⏳ **PENDING** — test",
  }),
}));

// ---------------------------------------------------------------------------
// Minimal Express app wiring the MCP endpoint — mirrors router.ts.
// Uses supertest so no TCP listener or port binding is required; this avoids
// EPERM failures in restricted CI environments (rootless containers, etc.).
// ---------------------------------------------------------------------------

const mcpApp = express();
mcpApp.use(express.json());

mcpApp.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on("close", () => server.close());
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED_TOOL_NAMES = [
  "bootstrap_framework",
  "create_project",
  "import_project",
  "configure_repo",
  "configure_cloud",
  "generate_assets",
  "capture_preview",
  "post_status",
];

async function mcpPost(body: object): Promise<{ status: number; data: unknown }> {
  const res = await request(mcpApp)
    .post("/mcp")
    .set("Content-Type", "application/json")
    .set("Accept", "application/json, text/event-stream")
    .send(body);
  // Strip SSE framing ("data: {...}\n\n") if present
  const text = res.text;
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  const json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : JSON.parse(text);
  return { status: res.status, data: json };
}

// ---------------------------------------------------------------------------
// TOOLS constant — pure data, no transport needed
// ---------------------------------------------------------------------------

describe("TOOLS constant", () => {
  it("exports all 8 expected tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TOOL_NAMES));
    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it("every tool has a non-empty description", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, `${tool.name} missing description`).toBeGreaterThan(10);
    }
  });

  it("every tool inputSchema specifies type: object", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema.type`).toBe("object");
    }
  });

  it("post_status tool lists all required params", () => {
    const tool = TOOLS.find((t) => t.name === "post_status")!;
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["github_repo", "pr_number", "status", "message"])
    );
  });

  it("create_project tool lists all required params", () => {
    const tool = TOOLS.find((t) => t.name === "create_project")!;
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "template", "github_owner", "approvers"])
    );
  });
});

// ---------------------------------------------------------------------------
// MCP server via HTTP — tools/list
// ---------------------------------------------------------------------------

describe("MCP endpoint — tools/list", () => {
  it("returns HTTP 200 with all 8 tools", async () => {
    const { status, data } = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(status).toBe(200);
    const tools = (data as { result?: { tools: { name: string }[] } }).result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TOOL_NAMES));
    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  it("each returned tool includes a description and inputSchema", async () => {
    const { data } = await mcpPost({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const tools = (data as { result?: { tools: { name: string; description: string; inputSchema: unknown }[] } }).result?.tools ?? [];
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// MCP server via HTTP — tools/call
// ---------------------------------------------------------------------------

describe("MCP endpoint — tools/call", () => {
  it("post_status returns a text content block with posted:false", async () => {
    const { status, data } = await mcpPost({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "post_status",
        arguments: {
          github_repo: "owner/repo",
          pr_number: 1,
          status: "pending",
          message: "MCP validation test",
        },
      },
    });

    expect(status).toBe(200);
    const result = (data as { result?: { content: { type: string; text: string }[]; isError?: boolean } }).result;
    expect(result?.isError).toBeFalsy();
    expect(result?.content[0].type).toBe("text");
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed).toMatchObject({ posted: false, status: "pending" });
  });

  it("returns isError:true for an unknown tool name", async () => {
    const { status, data } = await mcpPost({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "nonexistent_tool",
        arguments: {},
      },
    });

    expect(status).toBe(200);
    const result = (data as { result?: { isError: boolean; content: { text: string }[] } }).result;
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toMatch(/Unknown tool/);
  });

  it("returns isError:true when the action handler throws", async () => {
    // Override the postStatus mock to throw so we actually exercise the error path
    vi.mocked(postStatus).mockRejectedValueOnce(
      new Error("Invalid params: pr_number is required")
    );

    const { status, data } = await mcpPost({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "post_status",
        arguments: { github_repo: "bad" }, // intentionally missing required fields
      },
    });

    expect(status).toBe(200);
    const result = (data as { result?: { isError: boolean; content: { text: string }[] } }).result;
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toMatch(/Invalid params/);
  });
});
