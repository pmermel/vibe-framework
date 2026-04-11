# Phase 4 Validation Runbook

This runbook turns Phase 4 in `plan.md` and the end-to-end journeys in `.ai/context/USE_CASES.md` into one concrete validation sequence.

Use it before broadening the framework to additional templates or adapters. If this runbook does not pass cleanly, work should stay focused on fixing the default path rather than expanding scope.

## Scope

This runbook validates the current default path only:

- Framework bootstrap through `scripts/init.sh`
- Ongoing work through the provider-facing backend actions
- `create_project`
- `nextjs`
- `container-app`
- GitHub issue -> branch -> PR -> preview -> staging -> production

It does **not** validate Phase 4 expansion work such as:

- `react-vite`
- `static-web-app`
- `node-api`
- broader `import_project` stack support

Those stay blocked until this runbook is complete.

## Success Bar

Phase 4 validation is complete only when all of the following are true:

1. The framework bootstrap tier works from a shell-capable environment and leaves the framework repo in a healthy state.
2. The provider-facing MCP backend is reachable in production with the configured auth model.
3. `create_project` produces a real GitHub repository with a reviewable bootstrap PR and working preview flow.
4. Both Claude and Codex can operate on the same generated project using GitHub state as the handoff layer.
5. The generated project promotes cleanly from preview to staging to production through GitHub-owned transitions.
6. No provider-specific assumptions are found in generated files, workflows, or backend contracts.

## Preconditions

Before running this validation, confirm:

- `develop` contains the merged Phase 3 integration work, including production `/mcp` auth and the listener-independent backend test updates.
- The framework release ref used by generated projects is a real pinned release tag or SHA. `v1` is the expected default.
- Real GitHub App credentials are configured for the framework backend.
- Real Azure credentials are available for bootstrap and project provisioning.
- The generated project target is an org-owned or otherwise supported repository owner for the current walking skeleton.
- The validation operator can use both Claude and Codex during the same run, even if the work is split across sessions.

## Evidence To Capture

Record all validation evidence in GitHub so either provider can review or continue the work cold:

- Framework bootstrap logs or summarized outcomes on the tracking issue
- Link to the created project repository
- Link to the bootstrap PR
- Link to the feature issue used for cross-agent validation
- Link to the feature PR
- Preview URL and screenshot comment
- Staging deploy evidence
- Production approval and deploy evidence
- Handoff comments showing Codex -> Claude or Claude -> Codex continuation
- Any follow-up bugs opened during validation

## Validation Sequence

### 1. Validate the framework bootstrap tier

Run `scripts/init.sh` in a shell-capable environment and confirm:

- GitHub App setup completes without fail-open behavior
- Azure bootstrap completes
- The backend deploys successfully
- `scripts/validate-codespaces.sh` passes or returns a clearly documented non-blocking limitation
- `bootstrap_framework` reports healthy or clearly scoped degraded checks

If bootstrap fails, stop here and fix bootstrap. Do not continue to project-level validation.

### 2. Validate production MCP reachability

Use the deployed backend endpoint and production auth configuration to confirm:

- `/health` returns healthy
- `/mcp` is reachable with the configured Bearer token
- Codex can call a low-risk action such as `post_status`
- Claude can call the same action

This step re-validates the production path, not the earlier localtunnel-only proof.

### 3. Validate `create_project` on the default path

Create one brand-new project using the supported walking skeleton:

- `template: nextjs`
- `adapter: container-app`
- supported owner model for the current framework setup

Confirm:

- the GitHub repository is created
- the scaffold branch is pushed
- the bootstrap PR opens before provisioning completes
- `configure_cloud` and `configure_repo` run and surface outcomes back to the PR
- the PR contains the expected framework files and Azure output details

If provisioning fails, the failure must still be visible and recoverable from the PR.

### 4. Validate preview enrichment

On the bootstrap PR and on a normal feature PR later in the run, confirm:

- GitHub Actions deploys preview from PR state
- `capture_preview` posts a screenshot or returns a clearly documented deferred-storage outcome
- `post_status` posts a structured PR comment with the correct status and preview metadata
- preview review can happen from GitHub without relying on agent-local state

### 5. Validate cross-agent handoff on the same generated project

Create one real feature issue in the generated project and validate:

1. One provider claims the issue and opens or updates a feature PR.
2. That provider posts a handoff summary comment on the PR.
3. The second provider resumes from GitHub issue/PR state alone.
4. The second provider posts a takeover comment before pushing further changes.

The pass condition is not “both providers touched the repo.” The pass condition is that either provider can continue safely using GitHub as the system of record.

### 6. Validate staging and production promotion

After preview validation passes:

- merge the feature PR to `develop`
- confirm staging deploys from GitHub Actions
- validate staging behavior
- promote from `develop` to `main`
- confirm the production approval gate is enforced
- confirm production deploys only after GitHub approval

The backend may enrich PRs or report status, but it must not own promotion.

## Failure Handling

If any step fails:

- stop broadening scope
- record the blocker on the tracking issue
- open a focused follow-up issue when the fix is not trivial
- keep validation work centered on the default path until the blocker is cleared

Do **not** treat partial success as clearance to move on to `node-api`, `react-vite`, or `static-web-app`.

## Exit Criteria

Phase 4 can expand only after this runbook is fully satisfied and the evidence is captured in GitHub.

At that point, the recommended next order is:

1. `node-api`
2. `react-vite`
3. `static-web-app` broadening beyond the first adapter-specific implementation
