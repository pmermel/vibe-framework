import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { handleAction } from "./handler.js";
import { createMcpServer } from "./lib/mcp-server.js";

/**
 * router
 *
 * Express router wiring up all public endpoints:
 *
 * Always-available:
 * - GET  /health  — liveness probe, no auth
 * - POST /action  — direct action dispatcher for local testing and CI
 * - GET  /.well-known/oauth-protected-resource   — OAuth resource metadata (discovery only)
 * - GET  /.well-known/oauth-authorization-server — OAuth server metadata (discovery only)
 *
 * Dev-mode only (NODE_ENV !== "production"):
 * - GET  /oauth/authorize — immediately issues a code (no user interaction)
 * - POST /oauth/token     — exchanges any code for a static dev token
 *
 * Dev-mode only — /mcp (NODE_ENV !== "production"):
 * - POST /mcp   — StreamableHTTP MCP transport; tool list + tool call
 * - GET  /mcp   — SSE upgrade path used by some MCP clients
 * - DELETE /mcp — session teardown
 *
 * ⚠️  Auth model:
 *   In dev mode (NODE_ENV !== "production"), the OAuth token endpoints issue a
 *   static dev token without validating credentials. The /mcp endpoint accepts
 *   any request. This is intentional for the Phase 2 MCP validation run.
 *
 *   In production, /oauth/authorize, /oauth/token, and /mcp all return
 *   501 Not Implemented. /mcp remains disabled until real token validation
 *   is implemented — accepting arbitrary bearer tokens would expose privileged
 *   actions (create_project, configure_repo, configure_cloud) to any caller.
 */
export const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDevMode = process.env.NODE_ENV !== "production";

/**
 * deriveBaseUrl
 *
 * Returns the external-facing base URL for this request, respecting
 * X-Forwarded-Proto and X-Forwarded-Host headers when trust proxy is enabled.
 *
 * Does NOT read req directly — callers pass already-resolved values so this
 * function is independently unit-testable without an HTTP server.
 *
 * @param protocol - req.protocol (already resolved by Express trust-proxy logic)
 * @param host - req.get("host") (already resolved by Express trust-proxy logic)
 * @returns Full base URL string, e.g. "https://example.loca.lt"
 */
export function deriveBaseUrl(protocol: string, host: string): string {
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// Health check — always available
// ---------------------------------------------------------------------------

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// REST action endpoint — backwards-compatible local / CI surface
// ---------------------------------------------------------------------------

router.post("/action", handleAction);

// ---------------------------------------------------------------------------
// OAuth discovery metadata — always available (read-only, no credentials issued)
// ---------------------------------------------------------------------------

router.get("/.well-known/oauth-protected-resource", (req, res) => {
  const base = deriveBaseUrl(req.protocol, req.get("host") ?? "localhost");
  res.json({
    resource: base,
    authorization_servers: [base],
  });
});

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = deriveBaseUrl(req.protocol, req.get("host") ?? "localhost");
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
  });
});

// ---------------------------------------------------------------------------
// OAuth token endpoints — DEV MODE ONLY
// In production these return 501. Replace with real auth middleware before
// exposing the backend publicly.
// ---------------------------------------------------------------------------

router.get("/oauth/authorize", (req, res) => {
  if (!isDevMode) {
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "Dev auth stubs are disabled in production. " +
        "Configure real OAuth middleware before exposing this endpoint.",
    });
    return;
  }
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

router.post("/oauth/token", (req, res) => {
  if (!isDevMode) {
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "Dev auth stubs are disabled in production. " +
        "Configure real OAuth middleware before exposing this endpoint.",
    });
    return;
  }
  res.json({
    access_token: "vibe-dev-token",
    token_type: "Bearer",
    expires_in: 86400,
    scope: "mcp",
  });
});

// ---------------------------------------------------------------------------
// MCP endpoint — StreamableHTTP transport, stateless (no sessions)
// Dev-mode only. Returns 501 in production until real token validation exists.
// ---------------------------------------------------------------------------

async function handleMcp(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  if (!isDevMode) {
    // /mcp is disabled in production until real token validation is implemented.
    // Accepting an arbitrary bearer token would expose privileged actions
    // (create_project, configure_repo, configure_cloud) to any caller who can
    // reach the endpoint. Re-enable this path once a real auth store is wired up.
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "MCP endpoint is only available in development mode. " +
        "Configure real OAuth token validation before enabling in production.",
    });
    return;
  }

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
