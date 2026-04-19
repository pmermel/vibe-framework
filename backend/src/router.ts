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
 * - POST /action  — direct action dispatcher for GitHub Actions workflow enrichment
 * - GET  /.well-known/oauth-protected-resource   — OAuth resource metadata (discovery only)
 * - GET  /.well-known/oauth-authorization-server — OAuth server metadata (discovery only)
 *
 * Dev-mode only (NODE_ENV !== "production" and no MCP_API_KEY set):
 * - GET  /oauth/authorize — immediately issues a code (no user interaction)
 * - POST /oauth/token     — exchanges any code for a static dev token
 *
 * /mcp endpoint — StreamableHTTP MCP transport; tool list + tool call:
 * - POST /mcp
 * - GET  /mcp  — SSE upgrade path used by some MCP clients
 * - DELETE /mcp — session teardown
 *
 * ⚠️  Auth model for /mcp:
 *
 *   Production with MCP_API_KEY set:
 *     /mcp requires `Authorization: Bearer <MCP_API_KEY>`. Requests without a
 *     valid token receive 401. This is the production auth model — set MCP_API_KEY
 *     as a Container App secret (setup-azure.sh does this automatically).
 *
 *   Dev mode (NODE_ENV !== "production") without MCP_API_KEY:
 *     /mcp accepts any request. The OAuth token endpoints issue a static dev
 *     token without validating credentials. Intentional for local validation runs.
 *
 *   Production without MCP_API_KEY:
 *     /mcp returns 501. Safe default — prevents accidental exposure before the
 *     operator has completed MCP_API_KEY setup.
 *
 *   Both isDevMode() and MCP_API_KEY are read at request time (not module load)
 *   so tests can set process.env vars without reloading the module.
 */
export const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * isDevMode
 *
 * Returns true when NODE_ENV is not "production". Read at call time (not
 * module load) so tests can change process.env.NODE_ENV without reloading
 * the module, eliminating the need for vi.resetModules() in test files.
 */
function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

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

/**
 * validateMcpToken
 *
 * Validates the Authorization header against process.env.MCP_API_KEY.
 * Returns true if the request is authorized (or if no key is configured).
 * Returns false and sends a 401 response when validation fails.
 *
 * Reads MCP_API_KEY at call time so tests can change process.env without
 * reloading the module.
 */
function validateMcpToken(
  req: import("express").Request,
  res: import("express").Response
): boolean {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) return true; // No key configured — skip auth (dev mode)

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      error_description:
        "Bearer token required. Set Authorization: Bearer <MCP_API_KEY>.",
    });
    return false;
  }

  if (auth.slice(7) !== apiKey) {
    res.status(401).json({
      error: "unauthorized",
      error_description: "Invalid bearer token.",
    });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Health check — always available
// ---------------------------------------------------------------------------

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// REST action endpoint — production path for GitHub Actions workflow enrichment
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
// OAuth token endpoints — DEV MODE ONLY (no MCP_API_KEY configured)
// In production (or when MCP_API_KEY is set), these return 501.
// Replace with real auth middleware before exposing the backend publicly
// without MCP_API_KEY protection.
// ---------------------------------------------------------------------------

router.get("/oauth/authorize", (req, res) => {
  if (!isDevMode() || process.env.MCP_API_KEY) {
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "Dev auth stubs are disabled when MCP_API_KEY is set or in production. " +
        "Configure real OAuth middleware or use Bearer token auth.",
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
  if (!isDevMode() || process.env.MCP_API_KEY) {
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "Dev auth stubs are disabled when MCP_API_KEY is set or in production. " +
        "Configure real OAuth middleware or use Bearer token auth.",
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
//
// Auth behaviour (both read at request time):
//   - MCP_API_KEY set          → Bearer token required (dev or production)
//   - MCP_API_KEY not set + dev → open access (local validation runs)
//   - MCP_API_KEY not set + prod → 501 (safe default until key is configured)
// ---------------------------------------------------------------------------

async function handleMcp(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  const apiKey = process.env.MCP_API_KEY;

  // Safe default: production without a key → 501.
  // Prevents accidental exposure before MCP_API_KEY is provisioned.
  if (!isDevMode() && !apiKey) {
    res.status(501).json({
      error: "not_implemented",
      error_description:
        "MCP endpoint requires MCP_API_KEY to be configured in production. " +
        "Run setup-azure.sh to provision the key, then re-deploy the backend.",
    });
    return;
  }

  // When MCP_API_KEY is set, validate the bearer token regardless of environment.
  if (apiKey && !validateMcpToken(req, res)) {
    return; // 401 already sent by validateMcpToken
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
