import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { handleAction } from "./handler.js";
import { createMcpServer } from "./lib/mcp-server.js";

/**
 * router
 *
 * Express router wiring up all public endpoints:
 *
 * REST smoke-test surface (backwards-compatible):
 * - GET  /health  — liveness probe, no auth
 * - POST /action  — direct action dispatcher for local testing and CI
 *
 * MCP server endpoint:
 * - POST /mcp     — StreamableHTTP MCP transport; tool list + tool call
 * - GET  /mcp     — SSE upgrade path (used by some MCP clients for streaming)
 *
 * OAuth discovery stubs (dev-mode only):
 * - GET /.well-known/oauth-protected-resource  — tells MCP clients where auth lives
 * - GET /.well-known/oauth-authorization-server — OAuth 2.0 server metadata
 * - GET  /oauth/authorize  — immediately issues a code (no user interaction)
 * - POST /oauth/token      — exchanges any code or client_credentials for a dev token
 *
 * ⚠️  Auth note: the OAuth endpoints issue a static dev token and do NOT validate
 * credentials. This is intentional for the Phase 2 MCP validation run. Real auth
 * middleware must be added before the backend is exposed in production.
 */
export const router = Router();

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// REST action endpoint (backwards-compatible local / CI surface)
// ---------------------------------------------------------------------------

router.post("/action", handleAction);

// ---------------------------------------------------------------------------
// OAuth discovery stubs — satisfies MCP client auth discovery handshake
// ---------------------------------------------------------------------------

router.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    resource: base,
    authorization_servers: [base],
  });
});

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
  });
});

// Dev-mode authorize: immediately redirect with a static code, no user interaction
router.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri || typeof redirect_uri !== "string") {
    res.status(400).json({ error: "redirect_uri required" });
    return;
  }
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", "vibe-dev-code");
  if (state) redirectUrl.searchParams.set("state", state as string);
  res.redirect(redirectUrl.toString());
});

// Dev-mode token: issue a static bearer token for any valid-looking request
router.post("/oauth/token", (req, res) => {
  res.json({
    access_token: "vibe-dev-token",
    token_type: "Bearer",
    expires_in: 86400,
    scope: "mcp",
  });
});

// ---------------------------------------------------------------------------
// MCP endpoint — StreamableHTTP transport, stateless (no sessions)
// ---------------------------------------------------------------------------

async function handleMcp(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on("close", () => server.close());
}

router.post("/mcp", handleMcp);
router.get("/mcp", handleMcp);
router.delete("/mcp", handleMcp);
