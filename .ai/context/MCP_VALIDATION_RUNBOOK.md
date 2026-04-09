# MCP Validation Runbook — Issue #56

This runbook records the current MCP validation status for `vibe-framework` and the
steps required to close the validation gate in `plan.md` and `BOOTSTRAP_CONTRACTS.md`.

## Current Status — Gate Cleared ✅

- ✅ Direct REST reachability proven (`GET /health`, `POST /action`)
- ✅ `/mcp` endpoint implemented (issue #66) — `POST /mcp` handles MCP
  StreamableHTTP transport; all 8 actions are registered as tools
- ✅ OAuth discovery stubs in place so provider auth handshake completes
- ✅ Provider validation: Claude Code → passed (issue #56)
- ✅ Provider validation: Codex Desktop → passed (issue #56)

## Validation Outcome

| Provider | Result | Notes |
|---|---|---|
| Claude Code | ✅ Pass | OAuth + tools/list (8 tools) + post_status call succeeded |
| Codex Desktop | ✅ Pass | OAuth + tools/list (8 tools) + tool call succeeded |

**Architecture gate: cleared.** Both providers reach the same `/mcp` endpoint through standard OAuth 2.0 + StreamableHTTP transport. No provider-specific changes required.

**Caveats:**
- Validation was run against a localtunnel-exposed local backend (not a deployed instance). Localtunnel was flaky — ngrok recommended for future validation runs.
- Auth used development stubs (`vibe-dev-token`) — no real credential validation. Real OAuth must be implemented before the backend is exposed in production.
- `/mcp` is disabled in production (returns 501) until real OAuth is wired. REST `POST /action` is the only live production path today.

---

## Step 1 — Start the backend and expose it publicly

**Terminal 1 — start the backend**

```bash
cd /path/to/vibe-framework/backend
GITHUB_TOKEN=dummy npm run dev
```

**Terminal 2 — tunnel (no ngrok or Docker required)**

```bash
npx localtunnel --port 8080
```

Note the `https://<id>.loca.lt` URL as `<BASE_URL>`.

---

## Step 2 — Verify the backend directly

All three checks must pass before involving providers.

### Health check

```bash
curl -s <BASE_URL>/health
```

Expected: `{"status":"ok"}`

### MCP tools/list

```bash
curl -s -X POST <BASE_URL>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected HTTP 200 with SSE body containing a `result.tools` array of 8 tools.

### MCP tools/call — post_status

```bash
curl -s -X POST <BASE_URL>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "post_status",
      "arguments": {
        "github_repo": "pmermel/vibe-framework",
        "pr_number": 66,
        "status": "pending",
        "message": "MCP validation — direct curl probe"
      }
    }
  }'
```

Expected: HTTP 200, `result.content[0].text` contains JSON.

- **With valid GitHub App credentials configured:** `"posted": true`, `"comment_id": <n>`, `"comment_url": "<url>"` — a real comment is created on the PR.
- **With `GITHUB_TOKEN=dummy` (dev smoke-test only):** the GitHub API returns a 401/403 and the action surfaces the error. The MCP transport still returns 200 with a structured error body — proving MCP connectivity even without valid credentials.

For a standalone connectivity smoke-test, a GitHub API error is acceptable. For a full end-to-end validation, configure real GitHub App credentials and confirm `posted: true`.

---

## Step 3 — Register with Claude Code

Add to `~/.claude.json` or `.claude.json` in the project root under `mcpServers`:

```json
{
  "mcpServers": {
    "vibe-backend": {
      "type": "http",
      "url": "<BASE_URL>/mcp"
    }
  }
}
```

> ⚠️ The MCP transport is mounted at `/mcp`, not the root. Register `<BASE_URL>/mcp`,
> not just `<BASE_URL>`.

Restart Claude Code. The server will go through the OAuth discovery flow:
1. Claude Code fetches `<BASE_URL>/.well-known/oauth-protected-resource`
2. Claude Code fetches `<BASE_URL>/.well-known/oauth-authorization-server`
3. Claude Code opens the authorize URL in a browser — the dev stub immediately
   redirects with a code, no user interaction needed beyond the browser opening
4. Claude Code exchanges the code at `/oauth/token` and receives `vibe-dev-token`
5. Status should change to authenticated

Once authenticated, ask Claude to call `post_status`:

> Call the vibe-backend post_status tool with github_repo "pmermel/vibe-framework",
> pr_number 66, status "pending", message "MCP validation from Claude Code"

Expected: `status: "pending"` and either:
- `posted: true`, `comment_id: <n>`, `comment_url: "<url>"` if GitHub App credentials are configured, or
- A GitHub API error (401/403) if running with `GITHUB_TOKEN=dummy` — MCP transport connectivity is still confirmed by the structured error response.

Also test an error path — ask Claude to call post_status with missing required fields
and confirm it surfaces the error message from the backend.

---

## Step 4 — Register with Codex

Follow the Codex MCP connector registration flow for your environment. Provide:
- **Endpoint:** `<BASE_URL>/mcp`
- **Transport:** HTTP (StreamableHTTP)
- **Auth:** OAuth 2.0 — the backend auto-issues a dev token at `/oauth/token`

> ⚠️ Register `<BASE_URL>/mcp`, not just `<BASE_URL>`. The MCP transport is at `/mcp`;
> the root only serves discovery and OAuth endpoints.

Use the same canonical payload as Step 3 with `message: "MCP validation from Codex"`.

---

## Step 5 — Record results on GitHub issue #56

Post a comment on issue #56 with this template:

```
## MCP Validation Results

**Endpoint:** <BASE_URL>/mcp
**Deploy method:** localtunnel / Docker / ACA
**Backend version:** <git SHA>
**Auth:** OAuth dev stubs (temporary — no real credential validation)

### Direct curl
- [ ] GET /health → 200
- [ ] POST /mcp tools/list → 200, 8 tools
- [ ] POST /mcp tools/call post_status → 200, posted:true (or GitHub API error with dummy creds)

### Claude Code
- [ ] OAuth discovery + auth completed
- [ ] tools/list returns all 8 tools
- [ ] post_status call succeeds (posted:true with real creds; GitHub API error with dummy creds)
- [ ] Error path (invalid params) surfaced correctly
- [ ] Provider-specific caveats: <none / describe>

### Codex
- [ ] OAuth discovery + auth completed
- [ ] tools/list returns all 8 tools
- [ ] post_status call succeeds (posted:true with real creds; GitHub API error with dummy creds)
- [ ] Error path (invalid params) surfaced correctly
- [ ] Provider-specific caveats: <none / describe>

### Go/No-Go
- [ ] **GO** — both providers invoke /mcp reliably; expand action surface area
- [ ] **NO-GO** — blocker found: <describe>
```

---

## OAuth note

The OAuth endpoints (`/oauth/authorize`, `/oauth/token`,
`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`)
are **development stubs only**. They issue a static `vibe-dev-token` without validating
any credentials. Real auth middleware must be added before the backend is exposed
beyond local/tunnel validation runs.

---

## Teardown

- Stop the localtunnel process (`Ctrl-C`)
- Stop the backend process (`Ctrl-C`)
- Remove or disable the MCP server registration in both providers
- Post results to issue #56

---

## REST smoke-test reference (still valid)

```bash
# Health
curl -s <BASE_URL>/health

# Direct action (bypasses MCP transport)
curl -s -X POST <BASE_URL>/action \
  -H "Content-Type: application/json" \
  -d '{"action":"post_status","params":{"github_repo":"pmermel/vibe-framework","pr_number":66,"status":"pending","message":"direct REST smoke test"}}'
```
