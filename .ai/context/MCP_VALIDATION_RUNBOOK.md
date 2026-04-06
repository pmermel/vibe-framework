# MCP Validation Runbook — Issue #56

This runbook records the current MCP validation status for `vibe-framework` and the
steps required to close the validation gate in `plan.md` and `BOOTSTRAP_CONTRACTS.md`.

## Current Status

- ✅ Direct REST reachability proven (`GET /health`, `POST /action`)
- ✅ `/mcp` endpoint implemented (issue #66) — `POST /mcp` handles MCP
  StreamableHTTP transport; all 8 actions are registered as tools
- ✅ OAuth discovery stubs in place so provider auth handshake completes
- 🔲 Provider validation: Claude Code → `/mcp` not yet run
- 🔲 Provider validation: Codex → `/mcp` not yet run

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

Expected: HTTP 200, `result.content[0].text` contains JSON with `"posted": false`.

---

## Step 3 — Register with Claude Code

Add to `~/.claude.json` or `.claude.json` in the project root under `mcpServers`:

```json
{
  "mcpServers": {
    "vibe-backend": {
      "type": "http",
      "url": "<BASE_URL>"
    }
  }
}
```

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

Expected: `posted: false`, `status: "pending"`.

Also test an error path — ask Claude to call post_status with missing required fields
and confirm it surfaces the error message from the backend.

---

## Step 4 — Register with Codex

Follow the Codex MCP connector registration flow for your environment. Provide:
- **Endpoint:** `<BASE_URL>`
- **Transport:** HTTP (StreamableHTTP)
- **Auth:** OAuth 2.0 — the backend auto-issues a dev token at `/oauth/token`

Use the same canonical payload as Step 3 with `message: "MCP validation from Codex"`.

---

## Step 5 — Record results on GitHub issue #56

Post a comment on issue #56 with this template:

```
## MCP Validation Results

**Endpoint:** <BASE_URL>
**Deploy method:** localtunnel / Docker / ACA
**Backend version:** <git SHA>
**Auth:** OAuth dev stubs (temporary — no real credential validation)

### Direct curl
- [ ] GET /health → 200
- [ ] POST /mcp tools/list → 200, 8 tools
- [ ] POST /mcp tools/call post_status → 200, posted:false

### Claude Code
- [ ] OAuth discovery + auth completed
- [ ] tools/list returns all 8 tools
- [ ] post_status call succeeds (posted:false)
- [ ] Error path (invalid params) surfaced correctly
- [ ] Provider-specific caveats: <none / describe>

### Codex
- [ ] OAuth discovery + auth completed
- [ ] tools/list returns all 8 tools
- [ ] post_status call succeeds (posted:false)
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
