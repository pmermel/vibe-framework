# Use Cases

This file defines the intended real-world usage of vibe-framework.

It is not a second `plan.md`. `plan.md` remains the architecture and implementation source of truth. This file translates that architecture into concrete end-to-end journeys that future implementation, issues, and PR reviews must stay aligned with.

If implementation, issues, or PRs conflict with these journeys, this file and `plan.md` win.

## Experience Tiers

### Bootstrap tier
- One-time setup for a new GitHub account and Azure subscription.
- Operator-owned and shell-required, typically through local shell or Codespaces.
- Not the part of the product described as phone-first.

### Ongoing work tier
- Starts after bootstrap prerequisites are already in place.
- This is the phone-first path: provider tool -> issue -> branch -> PR -> preview -> promotion.
- All user-facing “work from phone” claims apply to this tier, not to first-time framework bootstrap.

## Journey 1 — Bootstrap The Framework Itself

**Actor:** Repo owner
**Trigger:** First-time setup on a new GitHub account and Azure subscription

### Happy path
1. The repo owner starts from a shell-capable environment and runs `init.sh`.
2. The bootstrap flow creates or connects the `vibe-framework` repository.
3. The bootstrap flow completes the GitHub App setup sub-flow: create or connect the app, apply required permissions, install it on the target owner, and store the private key securely.
4. The bootstrap flow provisions the shared Azure resource group and shared Container Apps environment for framework infrastructure.
5. The bootstrap flow deploys the minimal backend into that shared framework environment.
6. The bootstrap flow configures GitHub Actions OIDC trust in Azure.
7. The bootstrap flow exposes the backend as a real remote MCP server endpoint and registers that endpoint for Codex and Claude, or outputs manual registration instructions if automation is unavailable.
8. The bootstrap flow enables and validates GitHub Codespaces for the framework repository.

### Success outcome
- The backend is reachable through its provider-facing remote MCP server endpoint.
- GitHub App and Azure prerequisites are valid.
- The framework repo is ready for provider-tool-driven project bootstrap.

### Guardrails / non-goals
- The backend does not bootstrap itself for the first run.
- First-time framework bootstrap is always external to the backend.
- This journey may be initiated from Codespaces, but it is still part of the bootstrap tier rather than the phone-first ongoing-work tier.
- This journey only sets up framework infrastructure, not any specific generated project.

## Journey 2 — Create A Brand-New Project From The Ongoing Work Tier

**Actor:** User in ChatGPT/Codex or Claude
**Trigger:** Provider-tool `create_project` after bootstrap prerequisites already exist

### Happy path
1. The user invokes `create_project` from their provider app.
2. The backend creates a new GitHub repository through the GitHub App.
3. The backend scaffolds the selected template and writes the required framework files.
4. The backend enables Codespaces for the new repository (best-effort; non-fatal if plan/org restrictions apply).
5. The backend opens an initial bootstrap PR as soon as the scaffold branch is pushed — before any Azure provisioning — so failures leave a recoverable, reviewable GitHub surface.
6. The backend provisions a dedicated Azure Container Apps environment for that project via `configure_cloud`.
7. The backend creates the project repo's GitHub environments, per-environment OIDC secrets, variables, and approval settings via `configure_repo`.
8. On provisioning success: the PR body is updated with real Azure outputs (ACR, FQDNs, resource group). On failure: an error comment is posted to the PR and the error is re-thrown.
9. GitHub Actions runs the preview workflow on the bootstrap PR.
10. The backend posts preview status and a screenshot back to the PR via `capture_preview` + `post_status` after workflow-driven deployment completes.

### Success outcome
- A new project repo exists with a reviewable bootstrap PR.
- Preview deployment is reachable through GitHub workflow execution.
- The project is ready for normal issue-driven development.

### Guardrails / non-goals
- No direct commits to the default branch.
- GitHub remains the source of truth for PR state, preview state, and approvals.
- Project infrastructure is dedicated to that project and not shared with the framework backend environment.
- This journey assumes the bootstrap tier has already been completed successfully.

## Journey 3 — Adopt An Existing Repo

**Actor:** User importing an existing GitHub repository
**Trigger:** Provider-tool `import_project` or `init.sh --import` after bootstrap prerequisites already exist

**Current scope (Phase 3):** `import_project` supports **Next.js repos and empty/bare repos only**. The action validates the target repo before opening any PR: if `package.json` exists and `"next"` is absent from dependencies, it fails with a clear error. Empty repos (no `package.json`) proceed as Next.js targets — the caller is responsible for only passing repos that are or will become Next.js projects. Support for other stacks (Python, Ruby, Go, etc.) is deferred.

### Happy path
1. The user selects an existing Next.js (or empty) repository for adoption.
2. The backend validates the repo is accessible and the stack is supported (Next.js detected or empty).
3. The backend enables Codespaces for the repository (best-effort, non-fatal).
4. The backend opens a bootstrap PR — before any Azure provisioning — so failures leave a visible, recoverable GitHub surface.
5. The backend provisions a dedicated Azure Container Apps environment for the project.
6. The backend creates the repo's GitHub environments, secrets, variables, and approval settings.
7. That PR adds the framework adoption files plus only the minimum deployment-related changes needed; PR body is updated with Azure outputs on success, or an error comment is posted on failure.
8. GitHub Actions runs the preview workflow on the bootstrap PR.
9. The `post-enrichment` job calls the backend to post a screenshot and status comment to the PR after the deploy completes.

### Success outcome
- The existing Next.js repository is adoptable through a reviewable bootstrap PR.
- The repo gains framework structure without losing GitHub-centered review and approval.

### Guardrails / non-goals
- Never rewrite or directly modify the default branch during adoption.
- Avoid unrelated app refactors.
- Only make application-code changes when required for deployability, and keep them clearly visible in the bootstrap PR.
- This journey assumes the GitHub App, Azure trust, and backend remote MCP endpoint already exist from the bootstrap tier.
- Non-Next.js repos with a detected stack (package.json without `"next"`) are rejected. Repos of other stacks with no package.json are not detected — callers must not pass them.

## Journey 4 — Implement A Feature Through Issue To Branch To PR To Preview

**Actor:** Claude or Codex
**Trigger:** GitHub issue assignment or claim

### Happy path
1. An agent claims a GitHub issue and associates it with a `feature/*` branch.
2. The agent works through its native remote execution path.
3. The agent opens or updates a PR linked to the issue.
4. GitHub Actions deploys an Azure-hosted preview environment for that PR as the validation build for the proposed change.
5. After deployment completes, the backend posts screenshots, status, and related metadata to the PR.
6. The user reviews that Azure-hosted validation surface from phone or desktop and leaves feedback in GitHub or the provider app.
7. The agent iterates on the same issue and PR until preview validation passes.
8. The PR is merged only after the validation build is approved.

### Success outcome
- Every feature change is traceable from issue to branch to PR to preview.
- Preview review is GitHub-centered, accessible from mobile, and tied to an Azure-hosted validation build before merge.

### Guardrails / non-goals
- GitHub Actions own preview deployment.
- The backend only enriches the PR after workflow-driven deployment completes.
- The provider session is not the source of truth for work state.
- Validation should happen on the PR preview before merge, not by merging first and checking production later.

## Journey 5 — Cross-Agent Handoff On The Same Work

**Actor:** Outgoing provider and incoming provider
**Trigger:** One agent stops and another resumes the same branch or PR

### Happy path
1. The outgoing provider posts a summary comment on the PR describing current status, remaining work, and any risks.
2. The incoming provider reads the GitHub issue, PR, and comments rather than relying on chat-session memory.
3. The incoming provider posts a takeover comment before pushing new changes.
4. Work continues on the same branch and PR with GitHub preserving the shared state.

### Success outcome
- Either provider can continue work started by the other without ambiguity.
- Handoff is preserved in GitHub and reviewable later.

### Guardrails / non-goals
- Only one provider actively writes to a branch at a time.
- GitHub issue and PR comments are the canonical handoff mechanism.
- Hidden agent-local context is never required for continuation.

## Journey 6 — Promote Validated Work To Staging And Production

**Actor:** User plus GitHub Actions
**Trigger:** Merge to `develop`, then PR from `develop` to `main`

### Happy path
1. A validated feature PR is merged into `develop`.
2. GitHub Actions deploys the staging environment from `develop`.
3. The user reviews staging and opens or approves the promotion flow from `develop` to `main`.
4. GitHub Actions deploys production only after the required GitHub approval gate is satisfied.

### Success outcome
- Staging and production releases happen through explicit GitHub-controlled transitions.
- Production release remains auditable and user-approved.

### Guardrails / non-goals
- The backend never owns promotion.
- The backend never autonomously releases to production.
- Production deployment must remain gated by GitHub approvals, not agent discretion.
