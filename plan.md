# Vibe Framework v1 Implementation Plan

## Summary
Build this repository into a reusable framework for future projects where, after one-time operator bootstrap from a shell-capable environment, work can be initiated from the native ChatGPT/Codex or Claude apps on phone or desktop without requiring a physical machine for day-to-day coding, asset generation, repository operations, preview deployments, or production releases.

The v1 design is provider-native and GitHub-centered:
- ChatGPT/Codex and Claude are the user-facing entry points.
- GitHub is the shared system of record for issues, branches, PRs, checks, previews, and approvals.
- A minimal remote backend is part of v1 and exists to handle bootstrap, repo and cloud setup, preview support services, screenshots, asset generation, and status reporting on remote infrastructure.
- Actual coding in v1 uses the providers' native remote execution paths: Claude via Codespaces-compatible workflows and Codex via its native cloud execution flow.
- Azure Container Apps is the default deployment model for v1; Azure Static Web Apps is an optional adapter for static-only projects.

## Confirmed Decisions
- First validated project template: Next.js
- Framework implementation language: TypeScript
- One GitHub repo per generated project
- Branch model: `feature/*` -> `develop` -> `main`
- Staging branch: `develop`
- Production branch: `main`
- Primary work queue: GitHub Issues
- Primary approval surface: GitHub PRs plus GitHub environment approvals
- Default deploy target: Azure Container Apps
- Static-only adapter: Azure Static Web Apps
- Cloud auth: GitHub Actions OIDC to Azure
- Repo automation auth: GitHub App, not PAT
- Reusable workflow references: pinned release tags or commit SHAs, never `@main`
- One active writer per branch at a time
- Minimal backend in v1, full provider-neutral execution backend deferred
- `init.sh` remains a supported bootstrap entry point alongside remote-triggered bootstrap
- Bootstrap tier is operator-owned and requires a shell-capable environment such as Codespaces
- Ongoing work tier is the phone-first experience: issue -> branch -> PR -> preview
- Preview cost-control defaults are `deploy.preview.max_concurrent: 3` and `deploy.preview.ttl_hours: 48`
- `cloud: azure` is deferred in v1 to avoid implying multicloud support before adapters exist
- Live MCP invocation from both Codex and Claude is a validation gate before broad backend-action expansion
- The current v1 scaffold implementation is code-generated from TypeScript rather than a file-based `templates/` directory
- Broad Phase 3 work begins only after a short stabilization gate aligns canonical docs, release assumptions, and the current implementation status

## Core Architecture
### Product tiers
- **Bootstrap tier** is a one-time operator setup path for a new GitHub account and Azure subscription.
- Bootstrap tier is not marketed as phone-first; it requires a shell-capable environment such as local shell or Codespaces because GitHub App setup, Azure authentication, and first backend deployment happen before provider tools can call the backend.
- **Ongoing work tier** starts after bootstrap prerequisites are in place and is the part of the product that is phone-first: users create or pick GitHub work, invoke a provider, review previews, and approve promotions from GitHub.

### Provider-native workflow
- Users create or select work from GitHub on phone or desktop.
- Users then instruct ChatGPT/Codex or Claude to work on that GitHub issue or PR.
- Each provider reads the repo instructions, project manifest, and GitHub state, then uses its own native remote execution path to perform coding work.
- GitHub remains the handoff layer, so either provider can continue work started by the other.

### Minimal backend v1
- Implement a small TypeScript backend that supports the parts neither provider app handles reliably by itself.
- The backend is not a separate operator dashboard or full provider-neutral execution runtime.
- The backend runs in the shared Azure Container Apps environment provisioned during framework bootstrap and is framework-scoped infrastructure, not per-project infrastructure.
- The backend is responsible for:
  - remote project bootstrap for new repos
  - framework bootstrap for a new GitHub account and Azure subscription
  - GitHub repo and environment setup through the GitHub App
  - Azure provisioning and OIDC wiring
  - preview support services after workflow-driven deployment
  - preview screenshots and status callbacks to GitHub
  - asset generation and artifact storage when needed
- The backend does not need to own the day-to-day coding loop in v1.
- GitHub Actions are the canonical owner of preview deployment in v1; the backend only enriches the PR with screenshots, status, and related metadata after workflow-driven deploys complete.
- The provider-facing backend interface in v1 must be a real remote MCP server endpoint using the standard transport expected by Claude and Codex.
- The existing REST `POST /action` route may remain for direct smoke tests and local debugging, but it is not by itself sufficient for provider MCP registration and is not the canonical provider-facing interface.
- Full provider-neutral remote coding execution remains a v2 expansion path if native provider execution proves too limiting.

### Cross-agent coordination
- GitHub Issues are the task queue.
- A task is claimed when an agent associates a `feature/*` branch with the issue and posts a status comment naming the provider and run id.
- Only one provider may actively write to a branch at a time.
- Before a second provider continues an active branch or PR:
  - the outgoing provider posts a summary comment with current status, remaining work, and any risks
  - the incoming provider posts a takeover comment before pushing new changes
- PRs are the source of truth for:
  - preview URLs
  - screenshots
  - test and deploy status
  - handoff notes
  - approval and merge decisions

## Public Interfaces
### Project manifest
- Every generated project must include a root `vibe.yaml`.
- `vibe.yaml` is the single source of truth for project configuration consumed by both providers, bootstrap automation, and deployment workflows.
- `vibe.yaml` must include:
  - `name`
  - `template`
  - `adapter`
  - `providers`
  - `branch_policy`
  - `build`
  - `deploy`
  - `azure`
  - `github`
  - `approvers`

Example shape:

```yaml
name: my-app
template: nextjs
adapter: container-app
providers:
  - claude
  - codex

branch_policy:
  feature_prefix: feature/
  staging: develop
  production: main

build:
  install: npm ci
  test: npm test
  build: npm run build
  output: .next

deploy:
  preview:
    target: container-app
    max_concurrent: 3
    ttl_hours: 48
  staging:
    target: container-app
  production:
    target: container-app

azure:
  region: eastus2
  resource_group: my-app-rg
  registry: myappacr
  container_app_environment: my-app-env
  preview_app_prefix: my-app-pr
  staging_app: my-app-staging
  production_app: my-app-prod

github:
  repo: YOUR_GITHUB_USERNAME/my-app
  issues_as_work_queue: true
  workflow_refs:
    preview: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-preview.yml@v1
    staging: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-staging.yml@v1
    production: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-production.yml@v1
    preview_ttl_cleanup: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@v1

approvers:
  - YOUR_GITHUB_USERNAME
```

- `github.workflow_refs` in `vibe.yaml` is the canonical source of truth for reusable workflow version pinning; bootstrap and upgrade automation must generate or update the thin workflow wrapper files from those values rather than maintaining duplicate refs independently.
- `deploy.preview.max_concurrent` and `deploy.preview.ttl_hours` are the canonical preview cost-safety defaults; reusable preview lifecycle logic must enforce them once manifest-driven cleanup and concurrency controls are implemented.
- `cloud` is intentionally not a v1 manifest field. Azure is the only supported cloud target in v1, and reserving a top-level cloud selector is deferred until non-Azure adapters are real rather than implied.

### Backend contract
- The v1 backend must support these remote actions:
  - `bootstrap_framework`
  - `create_project`
  - `import_project`
  - `configure_repo`
  - `configure_cloud`
  - `generate_assets`
  - `capture_preview`
  - `post_status`
- `capture_preview` requires a headless browser runtime in the backend container, such as Playwright or Puppeteer, and that dependency must be accounted for in the backend image, runtime sizing, and Phase 1 scope.
- `generate_assets` in v1 is limited to practical project assets needed for web delivery and review, such as app icons, favicons, Open Graph images, placeholder marketing graphics, and screenshot artifacts attached to PRs.
- Promotion is GitHub-owned in v1. The backend may assist by posting status or preparing metadata, but it is not the canonical owner of release transitions and does not autonomously promote changes across environments.
- The canonical provider-facing contract is a remote MCP server endpoint, such as `/mcp`, exposing these actions as provider-neutral tools over standard MCP transport.
- The REST `POST /action` route is a non-canonical smoke-test surface. It may be used for direct curl checks and local debugging, but provider registration must target the remote MCP server endpoint instead.
- Provider-specific instruction files such as `CLAUDE.md` and `AGENTS.md` may guide behavior, but they must not carry canonical project config.

## Bootstrap And Project Lifecycle
### Framework bootstrap
- V1 must define a one-time setup path for the framework itself on a new GitHub account and Azure subscription.
- Framework bootstrap belongs to the bootstrap tier and is operator-owned, not phone-first.
- The framework bootstrap flow must:
  - create or connect the `vibe-framework` repository
  - complete the GitHub App setup sub-flow used for repository automation, including app creation or connection, permissions, installation, private-key storage, and installation-token minting
  - connect Codex cloud to the target GitHub account or organization through the required OAuth or repository access flow
  - enable and validate GitHub Codespaces for the framework repository so Claude can use a remote workspace without local machine setup
  - provision the shared Azure resource group and Container Apps environment
  - deploy the minimal backend into the shared Azure Container Apps environment
  - expose the minimal backend as a real remote MCP server endpoint for provider tool access
  - keep any REST action route only as a smoke-test/debug surface rather than the canonical provider-facing interface
  - register the remote MCP endpoint URL and auth configuration in the provider-specific tool or connector settings for Codex and Claude, or generate the manual registration instructions if automatic registration is not available
  - configure GitHub Actions OIDC trust in Azure
  - create the framework-level shared settings needed for project generation, such as the framework repo environments, framework repo variables, and any org-level configuration that can be safely reused across project repos
  - verify that shared prerequisites are functional before project generation begins, including GitHub App auth, Azure login, OIDC trust, backend reachability, remote MCP endpoint reachability, and provider MCP connectivity
- The first framework bootstrap must be triggered by `init.sh` or another external shell-capable setup path, because the backend does not exist until that bootstrap completes.
- `bootstrap_framework` may exist only as a post-bootstrap backend action for reconfiguration, validation, or repair after the backend has already been deployed.
- The GitHub App setup sub-flow is documented separately in `.ai/context/GITHUB_APP_SETUP.md` because it is a core bootstrap dependency rather than an implementation detail.

### Bootstrap path
- V1 supports two valid project bootstrap paths:
  - provider-tool-triggered project creation as the canonical ongoing-work path, using actions such as `create_project` or `import_project`, after bootstrap tier prerequisites already exist
  - `init.sh` as the primary manual operator entry point when a shell-capable environment is available
- The phone-first experience applies to project work after bootstrap prerequisites exist; it does not remove the need for one-time operator bootstrap.
- `create_project` is the fresh-repo bootstrap path:
  - create a new GitHub repo through the GitHub App
  - scaffold the selected template
  - write `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, workflows, and infrastructure files
  - enable and validate GitHub Codespaces for the generated repository and include a working `.devcontainer/devcontainer.json`
  - open an initial bootstrap PR as soon as the scaffold branch is pushed — before any Azure provisioning — so that failures leave a recoverable, reviewable GitHub surface
  - provision a dedicated Azure Container Apps environment for the generated project (via `configure_cloud`), plus its GitHub environment settings (via `configure_repo`), after the PR is open
  - on provisioning success: update the PR body with real Azure outputs; on failure: post an error comment to the PR and re-throw so the caller can recover
  - validate project-specific deployment plumbing, including preview deployment, after the project repo and environment exist
- `import_project` is the existing-repo adoption path — **currently scoped to Next.js repos and empty/bare repos only** (Phase 3):
  - validate the target repo is Next.js (package.json with `"next"` in deps) or empty; fail closed with a clear error for non-Next.js repos that have a package.json; repos with no package.json proceed as empty/bare (caller responsibility)
  - connect an existing GitHub repo through the GitHub App
  - open a bootstrap PR instead of modifying the default branch directly
  - add `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, workflow wrappers, `.devcontainer/devcontainer.json`, and required infra/config files
  - enable and validate GitHub Codespaces for the adopted repository
  - provision a dedicated Azure Container Apps environment for the adopted project, plus its GitHub environment settings
  - create the adopted repo's own GitHub environments, secrets, and variables required for preview, staging, and production workflows
  - avoid restructuring application code unless required for deployability and clearly shown in the bootstrap PR
  - support for arbitrary existing repos of other stacks (Python, Ruby, Go, etc.) is deferred to a future phase
- The provider tool is the canonical no-desktop trigger, but `init.sh` remains a first-class manual path for projects created outside the Claude or Codex front door.

### Generated repo model
- Each project repo consumes reusable workflows from this framework via pinned references.
- In v1, generated project files may come from code-based scaffold generators rather than a physical `templates/` directory. The contract is the generated output, not the storage format used inside the framework repo.
- The project repo includes:
  - `vibe.yaml`
  - `CLAUDE.md`
  - `AGENTS.md`
  - shared context docs or references
  - thin workflow wrappers
  - template-specific application code
- Framework workflow upgrades must be intentional and versioned.
- Each generated project gets its own Azure Container Apps environment for preview, staging, and production workloads; projects do not share the framework backend environment.

## Deployment Model
### Default path
- Use Azure Container Apps for preview, staging, and production by default.
- PRs into `develop` deploy ephemeral preview environments with phone-reviewable URLs inside the project's dedicated Container Apps environment.
- Merge to `develop` deploys a stable staging environment in that same project-specific environment.
- Promotion from `develop` to `main` is owned by GitHub through PR merges, required checks, and GitHub environment approval gates.

### Static adapter
- Azure Static Web Apps is allowed only as an adapter for static-only projects.
- Static adapter usage must be explicit in `vibe.yaml` through `adapter: static-web-app`.
- Static adapter workflows must still use the same GitHub issue, PR, preview, and approval conventions as the default deployment path.

### Security and release controls
- GitHub Actions authenticate to Azure with OIDC.
- Repository automation uses a GitHub App.
- Production deployment requires explicit user approval.
- Reusable workflows are pinned to tags or SHAs.

## Build Order
### Phase 1
- Create framework-level `CLAUDE.md`, `AGENTS.md`, and `.ai/context/CONVENTIONS.md`, `.ai/context/STACK.md`, and `.ai/context/AZURE_TARGETS.md`.
- Create `.devcontainer/devcontainer.json` for Codespaces-based Claude workflows and remote framework work.
- Define the `vibe.yaml` schema and the bootstrap contracts for both provider-tool-triggered setup and `init.sh`.
- Implement the minimal TypeScript backend for framework bootstrap, project bootstrap, preview support services, screenshots, and status callbacks.
- Add framework-level Codespaces enablement and validation as an explicit bootstrap requirement.

### Phase 2
- Create reusable GitHub workflows for preview, staging, and production.
- Create the first framework release tag (`v1`) and define the release process for future workflow and template upgrades.
- Add GitHub bootstrap automation for repo creation, branch protections, environments, labels, approvals, and GitHub App setup.
- Document the GitHub App setup sub-flow as a first-class bootstrap dependency rather than a checklist bullet.
- Add GitHub issue templates for feature work, bug fixes, project creation, and project import.
- Add a PR template covering linked issue, provider/run id, preview URL, screenshots, handoff notes, and validation checklist.
- Validate live remote MCP invocation of a low-risk backend action such as `post_status` or `capture_preview` from both Codex and Claude before broadening backend action implementation.
- Implement preview lifecycle controls in the reusable workflows, including preview cleanup on PR close or merge, preview TTL enforcement, and per-project concurrency limits for active previews driven by `vibe.yaml` defaults.
- Add Azure Bicep for Container Apps, OIDC, and optional Static Web Apps adapter resources.

### Phase 2.5 — Stabilization Gate
- Update the canonical docs so they accurately reflect what is already real, what is partial, and what remains deferred in the backend and bootstrap flows.
- Close the MCP validation loop in the canonical docs and GitHub records now that live Codex and Claude invocation has been proven.
- Verify the release-pin strategy before continuing to rely on `@v1`; use a verified release tag or a pinned SHA, but never an assumed tag.
- Implement `init.sh` as the shell bootstrap entry point for the bootstrap tier, or explicitly revise the bootstrap contract away from it before broad Phase 3 work begins.
- Make the provider-facing backend production-safe enough for real bootstrap use; dev-only auth stubs are acceptable for validation but not as the steady-state bootstrap path.
- Keep Phase 3 scoped to one walking skeleton until the first end-to-end path is proven.

### Phase 3
- Start with one supported walking skeleton only:
  - `create_project`
  - `nextjs`
  - `container-app`
  - org-owned repositories
- Build `init.sh` plus the remote bootstrap flow needed to support that walking skeleton end to end.
- Complete one vertical slice before broadening scope: `create_project` must create a real Next.js repository, provision the required repo and cloud settings, open a bootstrap PR, and reach a working preview flow through GitHub.
- Keep the current Next.js scaffold generator as the canonical v1 template implementation unless there is a deliberate decision to invest in file-based templates later.
- Add generated-repo Codespaces enablement and validation to the supported bootstrap path.
- Complete PR-visible backend enrichment for that path, including preview screenshots and status reporting.
- Defer `import_project`, `generate_assets`, additional templates, and broad adapter expansion until the first walking skeleton is proven end to end.

### Phase 4
- Validate the full issue-to-preview-to-staging-to-production loop on a sample Next.js project by following `.ai/context/PHASE4_VALIDATION_RUNBOOK.md`.
- Add React/Vite after the default path is proven and the static-web-app adapter is ready.
- Node API scaffold support is now implemented on the container-app path.

## Day-to-day Workflow
1. Create a GitHub issue from phone or desktop.
2. Ask ChatGPT/Codex or Claude to work on that issue.
3. The selected provider claims the issue, creates or resumes a branch, and works through its native remote execution path.
4. The provider opens or updates a PR.
5. GitHub Actions deploy the preview environment, and the minimal backend posts screenshots, status, and related metadata to the PR.
6. Review the preview from your phone and leave feedback in the PR or provider app.
7. The same provider or the other provider continues work using the PR and issue as the shared handoff layer.
8. Merge to `develop` when preview validation passes.
9. Review staging, then approve the `develop` to `main` promotion for production release.

## Test Plan
- Bootstrap the framework itself on a fresh GitHub account and Azure subscription and verify GitHub App, OIDC, and shared Azure resources are configured correctly.
- Verify framework bootstrap enables and validates GitHub Codespaces for the framework repository.
- Verify a fresh phone-only ChatGPT/Codex or Claude session can discover and invoke the backend MCP tools, including `create_project`, through the remote MCP server endpoint after framework bootstrap.
- Verify the Phase 2.5 stabilization gate: canonical docs match the real implementation state, the release ref strategy is explicit, and the shell bootstrap entry point is either implemented or intentionally revised.
- Create a brand-new project through `init.sh` and verify repo creation, manifest generation, GitHub setup, Azure provisioning, and the remote MCP bootstrap surface all succeed for the supported walking skeleton.
- Create a brand-new project through the provider-tool-triggered bootstrap path without using a local shell and verify it reaches the same configured state as the supported `init.sh` path.
- Verify a generated repository is Codespaces-ready and usable by Claude without local machine setup.
- Run the same issue through ChatGPT/Codex and Claude on different passes and verify safe branch handoff.
- Verify only one provider actively writes to a branch at a time.
- Verify GitHub Actions, not the backend, are the component that deploys preview environments on PR creation or update.
- Verify preview URLs, screenshots, and checks are posted back to the PR.
- Verify that closing or merging a PR tears down its ephemeral preview environment and removes the associated preview resources or Container App revision.
- Verify each generated project receives its own dedicated Container Apps environment and does not deploy into the shared framework backend environment.
- Verify promotion occurs only through GitHub PR merges and environment approvals, not backend-driven release transitions.
- Verify merge to `develop` deploys staging and `develop` to `main` deploys production with manual approval.
- Verify OIDC auth works without long-lived Azure deployment secrets.
- Verify workflow version pinning by intentionally upgrading a generated repo from one framework workflow release to another.

## Assumptions
- V1 targets web projects first.
- Next.js is the first validated template, not the only long-term project type.
- The framework repo includes both a shell-based bootstrap path and a remote bootstrap path.
- “No physical machine required” means users can complete the required workflow from provider tools plus remote infrastructure, even though a manual `init.sh` path remains available from a shell-capable environment such as Codespaces.
- Full provider-neutral remote code execution is deferred until native provider execution becomes a blocker.
- Azure Container Apps uses consumption-based pricing rather than a simple free static hosting model, so concurrent preview environments across multiple projects will need basic cost controls such as preview cleanup, TTLs, and concurrency limits.
