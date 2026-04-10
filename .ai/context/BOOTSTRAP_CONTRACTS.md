# Bootstrap Contracts

Defines the contracts for all bootstrap actions in vibe-framework. Both providers must implement or invoke these contracts identically.

## Implementation Status

| Action | Status | Notes |
|---|---|---|
| `create_project` (nextjs + container-app) | ✅ Implemented | Full bootstrap orchestrator: creates GitHub repo, scaffolds Next.js, enables Codespaces, opens bootstrap PR immediately (GitHub-centered handoff surface exists before provisioning), then calls `configure_cloud` + `configure_repo` when `azure_subscription_id` is provided; updates PR body with Azure outputs on success; posts error comment to PR on provisioning failure and re-throws. `configure_repo` receives per-environment `azure_client_ids` map from `configure_cloud` output. react-vite/node-api deferred to Phase 4. |
| `configure_repo` | ✅ Implemented | Branch protections, environments, labels, OIDC secrets via GitHub App |
| `configure_cloud` | ✅ Implemented | Deploys `container-apps-env.json` ARM template; provisions OIDC credentials via Microsoft Graph REST API; assigns Contributor + AcrPush roles via ARM REST; idempotent (check-before-create + deterministic GUID names); returns Azure outputs for `configure_repo` |
| `post_status` | ✅ Implemented | Posts real GitHub PR comment via `issues.createComment`; returns `posted: true`, `comment_id`, `comment_url`. When `screenshot_url` is provided, embeds Markdown image in the comment body alongside the status/message. |
| `capture_preview` | ✅ Implemented | Playwright screenshot captured and uploaded to Azure Blob Storage (`screenshots` container in framework-level Storage Account provisioned by `framework-env.bicep`). Returns `{ posted: true, screenshot_url }` when `AZURE_STORAGE_ACCOUNT_NAME` is set (managed-identity auth via `DefaultAzureCredential`). Falls back to `{ posted: false, posted_deferred_reason: "external_storage_required" }` when not configured. Blob name: `pr-{pr_number}/{timestamp}.png`. |
| `import_project` | 🔲 Stub | Returns `not_implemented`; deferred to Phase 3 |
| `bootstrap_framework` | ✅ Implemented | Validates GitHub App auth, backend `/health`, and GitHub environments (`preview`/`staging`/`production`); returns `{ status: "ok"\|"degraded", checks: { github_app, backend_health, environments }, details: string[] }`; never throws on check failure |
| `generate_assets` | 🔲 Stub | Returns `not_implemented`; deferred to Phase 3 |

Stubs accept and validate the documented params (Zod schemas enforced — invalid params → 400) but return `{ status: "not_implemented" }` for valid requests without making external calls.

## Validation Gates

These gates prevent the framework from expanding backend surface area faster than the core architecture is proven.

1. **MCP connectivity gate** ✅ Cleared (issue #56)
   - Proved that a live deployed backend can be invoked from both Codex and Claude through MCP.
   - Validated: Claude Code and Codex Desktop both invoked backend actions via MCP over localtunnel.
   - Note: MCP is disabled in production (501) until real OAuth is wired. Dev-mode validation only.
   - ngrok recommended over localtunnel for future validation runs (more stable).
2. **Walking skeleton gate** ✅ Cleared (issue #55)
   - Proved one complete vertical slice: `create_project` → real GitHub repository → bootstrap PR.
   - Phase 3 expansion: `create_project` now orchestrates `configure_cloud` + `configure_repo` inline when `azure_subscription_id` is provided, completing the full Azure provisioning + GitHub environment/secret wiring in a single action call. PR enrichment (screenshot posting via Azure Blob Storage) implemented in Phase 3 via `capture_preview` + `post_status`.

## GitHub App Setup Sub-Flow

GitHub App setup is a first-class bootstrap dependency, not a checklist bullet. Full setup details live in `.ai/context/GITHUB_APP_SETUP.md`.

### Responsibilities
1. Create a new GitHub App or connect an existing one intended for repository automation.
2. Apply the required permissions for bootstrap and ongoing repo automation.
3. Install the app on the target user or organization and the framework repo.
4. Export the private key and store it in Azure Key Vault or a Container Apps secret.
5. Mint installation tokens at runtime from the private key rather than storing PATs.
6. Fail closed if permissions, installation scope, or private-key storage are incomplete.

## Framework Bootstrap

**Trigger:** `init.sh` (first-time only — backend does not exist yet)
**Repair/reconfigure:** `bootstrap_framework` backend action

### Steps
1. Create or connect the `vibe-framework` GitHub repository.
2. Complete the GitHub App setup sub-flow with required permissions:
   - Contents: read/write
   - Pull requests: read/write
   - Issues: read/write
   - Actions: read/write
   - Environments: read/write
   - Secrets and variables: read/write
   - Administration: read/write (branch protections)
3. Store the GitHub App private key in Azure Key Vault or Container Apps secret.
4. Connect Codex cloud to the target GitHub account via OAuth or repository access flow.
5. Enable and validate GitHub Codespaces for the framework repository.
6. Provision shared Azure resource group and Container Apps environment.
7. Deploy the minimal backend into the shared Container Apps environment.
8. Expose the backend as a real remote MCP server endpoint (for example `/mcp`) for provider access.
9. Keep any REST action route only as a smoke-test/debug surface, then register the remote MCP endpoint and auth in provider tool/connector settings, or generate manual registration instructions.
10. Configure GitHub Actions OIDC trust in Azure.
11. Create framework-level GitHub environments, variables, and shared settings.
12. Verify prerequisites: GitHub App auth, Azure login, OIDC trust, backend reachability, remote MCP endpoint reachability, provider MCP connectivity.

### Success criteria
- Backend is reachable at its remote MCP endpoint.
- `create_project` can be invoked from a provider tool through the remote MCP endpoint.
- GitHub Codespaces is enabled and usable for the framework repo.

---

## `create_project` — Fresh Repo Bootstrap

**Trigger:** Provider tool call or `init.sh --new`
**Use case:** Brand-new project with no existing GitHub repo.

This action belongs to the ongoing work tier, but it is only valid after framework bootstrap has already completed.

### Steps
1. Resolve `azure_subscription_id`: prefer caller-supplied param, fall back to `AZURE_SUBSCRIPTION_ID` env var (set by `setup-azure.sh` during framework bootstrap). Throw immediately if neither is set — no resources are created.
2. Create a new GitHub repo through the GitHub App.
3. Scaffold the selected template into the repo.
4. Write `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, `.ai/context/`, `.devcontainer/devcontainer.json`, workflow wrappers, and infrastructure files.
5. Enable GitHub Codespaces for the generated repository (best-effort — non-fatal if plan/org restrictions apply).
6. Create `develop` and `bootstrap/vibe-setup` branches from the scaffold commit.
7. **Open the bootstrap PR immediately** — before any Azure provisioning. The PR is the GitHub-centered handoff surface and must exist so failures leave a recoverable, visible state in GitHub.
8. Provision a **dedicated** Azure Container Apps environment for the project via `configure_cloud` (not the framework backend env).
9. Configure GitHub environments (`preview`, `staging`, `production`) with per-environment OIDC secrets and branch protections via `configure_repo`.
10. On provisioning success: update the PR body with real Azure outputs (ACR login server, staging/production FQDNs, resource group).
11. On provisioning failure: post an error comment to the PR with the error details and retry instructions, then re-throw so the caller sees the failure.
12. After the bootstrap PR is open, GitHub Actions runs the preview workflow and deploys the first preview environment.
13. The `post-enrichment` job in `reusable-preview.yml` (triggered automatically after the deploy job succeeds) calls `capture_preview` then `post_status` on the backend, posting a screenshot and structured status comment back to the bootstrap PR. No agent action is required — GitHub Actions drives steps 12–13. The enrichment job is `continue-on-error: true` and skipped gracefully when `VIBE_BACKEND_URL` is not set.

### Bootstrap PR contents
- All generated files (`vibe.yaml`, instruction files, workflows, infra)
- Azure provisioning outputs table on success (ACR login server, FQDNs, resource group); placeholder checklist if provisioning is retried separately
- Error comment with retry instructions if provisioning fails

### Success criteria
- Bootstrap PR is open and reviewable.
- GitHub Actions preview workflow completes successfully on the bootstrap PR.
- Preview environment is reachable and screenshot is posted to the PR.
- Codespaces is enabled and usable for the generated repo.

---

## `import_project` — Existing Repo Adoption

**Trigger:** Provider tool call or `init.sh --import`
**Use case:** Adopting an existing GitHub repo into the framework.

This action belongs to the ongoing work tier, but it is only valid after framework bootstrap has already completed.

### Steps
1. Connect the existing GitHub repo through the GitHub App.
2. Enable and validate GitHub Codespaces for the adopted repo.
3. Provision a **dedicated** Azure Container Apps environment for the project.
4. Create GitHub environments with required secrets, variables, and approval gates.
5. Validate pre-PR prerequisites: GitHub App auth, Azure OIDC trust, Container Apps environment reachability.
6. Open a **bootstrap PR** — do not modify the default branch directly.
7. Add to the bootstrap PR: `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, `.ai/context/`, `.devcontainer/devcontainer.json`, workflow wrappers, and required infra/config files.
8. After the bootstrap PR is open, GitHub Actions runs the preview workflow and deploys the first preview environment.
9. The `post-enrichment` job in `reusable-preview.yml` calls `capture_preview` then `post_status` on the backend automatically after the deploy job succeeds. No agent action required. The enrichment job is `continue-on-error: true` and skipped gracefully when `VIBE_BACKEND_URL` is not set.
10. Avoid restructuring application code unless required for deployability; limit changes to framework adoption files.

### Bootstrap PR contents
- All framework adoption files
- Minimum application changes required for deployability (clearly labeled)
- Summary of what was provisioned
- Checklist: preview URL (populated after CI runs), OIDC status, Codespaces status

### Success criteria
- Bootstrap PR is open and reviewable.
- GitHub Actions preview workflow completes successfully on the bootstrap PR.
- Preview environment is reachable and screenshot is posted to the PR.
- No unrequested changes to application code.

---

## `configure_repo` — Repo Settings Action

**Trigger:** Backend action (called during `create_project` or `import_project`)

### Responsibilities
- Apply branch protections to `develop` and `main`.
- Create GitHub labels: `feature`, `fix`, `docs`, `infra`, `chore`, `phase-1` through `phase-4`.
- Create GitHub environments: `preview`, `staging`, `production`.
- Set per-environment OIDC secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) using `azure_client_ids` map from `configure_cloud` output.
- Create the `VIBE_BACKEND_URL` GitHub Actions repo variable when `backend_url` is provided. `create_project` passes `process.env.BACKEND_URL` (set on the Container App by `setup-azure.sh`). This variable is what the `post-enrichment` job in `reusable-preview.yml` reads to call the vibe backend for screenshot + status posting. When absent, no variable is created and enrichment silently skips.
- Configure required status checks for PR merges.
- Set production environment protection rules (manual approval required).

---

## `configure_cloud` — Azure Provisioning Action

**Trigger:** Backend action (called during `create_project` or `import_project`)

### Responsibilities
- Create the project's dedicated resource group.
- Create the project's dedicated Container Apps environment.
- Create staging and production Container Apps.
- Create OIDC federated credentials on the Azure service principal for `preview`, `staging`, and `production` environments.
- Create Key Vault if needed and grant backend managed identity access.
- Output resource IDs and URLs for use in `configure_repo`.

---

## `bootstrap_framework` — Framework Repair Action

**Trigger:** Backend action only (not `init.sh` — that is the first-time path)
**Use case:** Reconfiguration, validation, or repair after backend is already deployed.

### Responsibilities
- Validate GitHub App auth (`octokit.apps.getAuthenticated()`).
- Validate backend `/health` endpoint is reachable and returns 200.
- Validate GitHub environments (`preview`, `staging`, `production`) exist on the framework repo.

**Out of scope for current implementation:** OIDC trust validation, MCP endpoint reachability, Codespaces enablement, and re-applying framework settings are not performed by this action. If those checks are needed, run them manually or extend this action in a future phase.

---

## Promotion Contract

Promotion is **GitHub-owned**. The backend does not initiate deployments or release transitions.

| Transition | Owner | Mechanism |
|---|---|---|
| feature → preview | GitHub Actions | PR open/push trigger |
| preview → staging | GitHub Actions | Merge to `develop` trigger |
| staging → production | GitHub Actions + user | Merge to `main` + manual environment approval |

The backend may post status, screenshots, and metadata to PRs, but it must not autonomously merge, promote, or release.
