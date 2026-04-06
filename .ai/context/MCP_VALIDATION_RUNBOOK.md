# MCP Validation Runbook — Issue #56

This runbook records the current MCP validation status for `vibe-framework` and the
steps required to close the validation gate in `plan.md` and `BOOTSTRAP_CONTRACTS.md`.

## Current Finding

- Direct internet reachability of the backend REST app has been proven with:
  - `GET /health`
  - `POST /action`
- That direct REST proof is useful, but it is **not** sufficient to satisfy the
  provider-facing MCP contract.
- The current provider-facing path is a **NO-GO** because the backend does not yet
  expose a real remote MCP server endpoint. Registering the raw REST app URL with
  a provider is not the canonical interface and must not be treated as a passing MCP
  validation.

## Contract Clarification

- The canonical provider-facing interface is a remote MCP server endpoint, such as
  `/mcp`, using the standard MCP transport expected by both Claude and Codex.
- The existing REST `POST /action` route is a smoke-test and local-debugging surface.
- Direct curl checks against `/health` and `/action` are still valuable because they:
  - prove the backend process is reachable
  - prove action dispatch and validation work
  - isolate transport/protocol issues from action implementation issues
- Direct curl checks against `/health` and `/action` do **not** prove that a provider
  can discover tools, negotiate transport, and invoke the backend through MCP.

## Current Validation Status

### Direct REST smoke tests

These checks are valid today and should continue to pass:

```bash
curl -s <BASE_URL>/health
```

Expected:

```json
{"status":"ok"}
```

```bash
curl -s -X POST <BASE_URL>/action \
  -H "Content-Type: application/json" \
  -d '{
    "action": "post_status",
    "params": {
      "github_repo": "pmermel/vibe-framework",
      "pr_number": 65,
      "status": "pending",
      "message": "MCP validation — direct REST smoke test"
    }
  }'
```

Expected HTTP 200:

```json
{
  "ok": true,
  "result": {
    "github_repo": "pmermel/vibe-framework",
    "pr_number": 65,
    "status": "pending",
    "posted": false
  }
}
```

An invalid request should still return HTTP 400.

### Provider MCP validation

Current status: **blocked**

Reason:

- The backend does not yet expose a real remote MCP endpoint for tool discovery and
  tool invocation over standard MCP transport.
- Provider registration must target that remote MCP server endpoint once implemented.
- Do not register the raw REST application URL as a passing MCP integration.

## Exit Criteria For Issue #56

Issue `#56` is not complete until all of the following are true:

- A real remote MCP server endpoint exists and is internet-reachable.
- Claude can register that endpoint, list tools, and call `post_status`.
- Codex can register that same endpoint, list tools, and call `post_status`.
- The results and any provider-specific caveats are documented in GitHub.

## After `/mcp` Exists

When the remote MCP server endpoint is implemented, update this runbook with:

- the canonical remote endpoint path
- provider registration instructions for Claude and Codex
- a shared `post_status` validation payload for both providers
- expected success and failure outputs through MCP, not just direct REST
