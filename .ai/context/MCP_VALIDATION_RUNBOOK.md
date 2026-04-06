# MCP Validation Runbook — Issue #56

Proves that a live deployed backend can be invoked from both Codex and Claude through
MCP before backend action surface area is expanded further. This is the architecture gate
defined in `BOOTSTRAP_CONTRACTS.md`.

## Scope

- **Action under test:** `post_status`
- **Why this action:** validates the full transport + dispatch cycle with no real side
  effects (`posted: false` until the GitHub comment step is implemented).
- **No new code:** this runbook validates the existing contract only.
- **Auth note:** the backend has no auth middleware yet. Restrict network access to the
  validation endpoint for the duration of the test run and document it here. This is
  temporary validation exposure, not the final security model.

---

## Step 1 — Deploy or identify a live backend endpoint

You need an HTTPS endpoint reachable from the internet.

### Option A — Local + ngrok (fastest, no Azure required)

```bash
# Terminal 1: start the backend
cd backend
GITHUB_TOKEN=<any-valid-pat> npm run dev

# Terminal 2: expose it publicly
ngrok http 8080
```

Note the `https://<id>.ngrok-free.app` URL. Use it as `<BASE_URL>` below.

### Option B — Docker + ngrok (closer to production)

```bash
docker build -t vibe-backend ./backend
docker run -p 8080:8080 -e GITHUB_TOKEN=<any-valid-pat> vibe-backend
ngrok http 8080
```

### Option C — Azure Container Apps (production path)

Prerequisites: resource group, shared Container Apps environment, and OIDC trust
must already exist (see `scripts/setup-azure.sh`).

```bash
# Build and push to ACR (replace <acr> and <tag>)
az acr build --registry <acr> --image vibe-backend:<tag> ./backend

# Deploy a short-lived validation revision
az containerapp create \
  --name vibe-backend-validation \
  --resource-group <rg> \
  --environment <aca-env> \
  --image <acr>.azurecr.io/vibe-backend:<tag> \
  --target-port 8080 \
  --ingress external \
  --env-vars GITHUB_TOKEN=<secretref:github-token>
```

Record the FQDN from the output as `<BASE_URL>`.

---

## Step 2 — Verify the endpoint directly (before involving providers)

All three checks must pass before running provider tests.

### 2a — Health check

```bash
curl -s <BASE_URL>/health
```

Expected: `{"status":"ok"}`

### 2b — Valid post_status request

```bash
curl -s -X POST <BASE_URL>/action \
  -H "Content-Type: application/json" \
  -d '{
    "action": "post_status",
    "params": {
      "github_repo": "pmermel/vibe-framework",
      "pr_number": <any-open-pr-number>,
      "status": "pending",
      "message": "MCP validation — direct curl probe",
      "preview_url": null
    }
  }'
```

Expected HTTP 200:
```json
{
  "ok": true,
  "result": {
    "github_repo": "pmermel/vibe-framework",
    "pr_number": <n>,
    "status": "pending",
    "posted": false,
    "comment_body": "⏳ **PENDING** — MCP validation — direct curl probe"
  }
}
```

### 2c — Invalid request (validation probe)

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST <BASE_URL>/action \
  -H "Content-Type: application/json" \
  -d '{"action":"post_status","params":{"github_repo":"bad","pr_number":-1}}'
```

Expected: `400`

If all three pass, proceed to provider tests.

---

## Step 3 — Register the endpoint with each provider

### Claude Code (MCP config)

Add to `~/.claude/mcp.json` (or project-level `.mcp.json`):

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

Restart Claude Code. The `post_action` tool (mapped from `POST /action`) should appear
in the available tools list.

### OpenAI Codex

Follow the Codex MCP connector registration flow for your environment. Provide:
- **Endpoint:** `<BASE_URL>`
- **Schema:** see `POST /action` contract below
- **Auth:** none for this validation run

---

## Step 4 — Canonical validation payload

Use exactly this payload for both providers so results are directly comparable:

```json
{
  "action": "post_status",
  "params": {
    "github_repo": "pmermel/vibe-framework",
    "pr_number": <any-open-pr-number>,
    "status": "pending",
    "message": "MCP validation from <provider-name>"
  }
}
```

**Expected success (HTTP 200):**
```json
{
  "ok": true,
  "result": {
    "github_repo": "pmermel/vibe-framework",
    "pr_number": <n>,
    "status": "pending",
    "posted": false,
    "comment_body": "⏳ **PENDING** — MCP validation from <provider-name>"
  }
}
```

**Expected validation failure (HTTP 400):**
Send one intentionally invalid request per provider (e.g. omit `github_repo`). Confirm
the provider surfaces the 400 and the error detail — this tests the error path, not just
the happy path.

---

## Step 5 — Record results on GitHub issue #56

Post a comment on issue #56 containing:

```
## MCP Validation Results

**Endpoint:** <BASE_URL> (ngrok / ACA / other)
**Deploy method:** <Option A / B / C>
**Auth:** none (temporary validation exposure)
**Backend version:** <git SHA>

### Direct curl
- [ ] GET /health → 200
- [ ] POST /action (valid) → 200, posted: false
- [ ] POST /action (invalid) → 400

### Claude Code
- [ ] Registration method: automatic / manual
- [ ] POST /action → 200
- [ ] Error path (400) surfaced correctly
- [ ] Provider-specific caveats: <none / describe>

### Codex
- [ ] Registration method: automatic / manual
- [ ] POST /action → 200
- [ ] Error path (400) surfaced correctly
- [ ] Provider-specific caveats: <none / describe>

### Go/No-Go
- [ ] **GO** — both providers invoke the backend reliably; expand action surface area
- [ ] **NO-GO** — blocker found: <describe>
```

If NO-GO, capture the blocker category:
- endpoint deployment / reachability
- provider registration / connectivity
- protocol mismatch (request shape, response shape)
- architecture-level incompatibility

---

## POST /action contract reference

```
POST /action
Content-Type: application/json

{
  "action": "post_status",
  "params": {
    "github_repo": "owner/repo",   // required, "owner/repo" format
    "pr_number":   1,              // required, positive integer
    "status":      "pending",      // required, "pending" | "success" | "failure"
    "message":     "text",         // required, string
    "preview_url": "https://..."   // optional, valid URL
  }
}
```

Success response (200):
```json
{ "ok": true, "result": { ... } }
```

Validation error response (400):
```json
{ "ok": false, "error": "Invalid params: [...]" }
```

Unexpected error response (500):
```json
{ "ok": false, "error": "Internal server error" }
```

---

## Teardown

After validation is complete:
- If ngrok: `Ctrl-C` both processes
- If Docker: `docker stop <container-id>`
- If ACA: `az containerapp delete --name vibe-backend-validation --resource-group <rg>`
- Remove or disable the MCP endpoint registration in both providers
- Post final results to issue #56 and close it with `state_reason: completed`
