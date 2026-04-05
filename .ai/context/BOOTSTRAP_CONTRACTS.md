# Bootstrap Contracts

Defines the contracts for all bootstrap actions in vibe-framework. Both providers must implement or invoke these contracts identically.

## Framework Bootstrap

**Trigger:** `init.sh` (first-time only — backend does not exist yet)
**Repair/reconfigure:** `bootstrap_framework` backend action

### Steps
1. Create or connect the `vibe-framework` GitHub repository.
2. Register or connect the GitHub App with required permissions:
   - Contents: read/write
   - Pull requests: read/write
   - Issues: read/write
   - Actions: read/write
   - Environments: read/write
   - Secrets and variables: read/write
   - Administration: read/write (branch protections)
3. Store GitHub App private key in Azure Key Vault or Container Apps secret.
4. Connect Codex cloud to the target GitHub account via OAuth or repository access flow.
5. Enable and validate GitHub Codespaces for the framework repository.
6. Provision shared Azure resource group and Container Apps environment.
7. Deploy the minimal backend into the shared Container Apps environment.
8. Expose the backend as an MCP-compatible endpoint.
9. Register backend endpoint and auth in provider tool/connector settings, or generate manual registration instructions.
10. Configure GitHub Actions OIDC trust in Azure.
11. Create framework-level GitHub environments, variables, and shared settings.
12. Verify prerequisites: GitHub App auth, Azure login, OIDC trust, backend reachability, provider MCP connectivity.

### Success criteria
- Backend is reachable at its MCP endpoint.
- `create_project` can be invoked from a provider tool.
- GitHub Codespaces is enabled and usable for the framework repo.

---

## `create_project` — Fresh Repo Bootstrap

**Trigger:** Provider tool call or `init.sh --new`
**Use case:** Brand-new project with no existing GitHub repo.

### Steps
1. Create a new GitHub repo through the GitHub App.
2. Scaffold the selected template into the repo.
3. Write `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, `.ai/context/`, `.devcontainer/devcontainer.json`, workflow wrappers, and infrastructure files.
4. Enable and validate GitHub Codespaces for the generated repository.
5. Provision a **dedicated** Azure Container Apps environment for the project (not the framework backend env).
6. Create GitHub environments (`preview`, `staging`, `production`) with required secrets, variables, and approval gates.
7. Validate pre-PR prerequisites: GitHub App auth, Azure OIDC trust, Container Apps environment reachability, Codespaces enablement.
8. Open an initial **bootstrap PR** — do not commit directly to the default branch.
9. After the bootstrap PR is open, GitHub Actions runs the preview workflow and deploys the first preview environment.
10. Validate the preview deployment is reachable and post status + screenshot back to the bootstrap PR.

### Bootstrap PR contents
- All generated files (`vibe.yaml`, instruction files, workflows, infra)
- Summary of what was provisioned
- Checklist: preview URL (populated after CI runs), OIDC status, Codespaces status

### Success criteria
- Bootstrap PR is open and reviewable.
- GitHub Actions preview workflow completes successfully on the bootstrap PR.
- Preview environment is reachable and screenshot is posted to the PR.
- Codespaces is enabled and usable for the generated repo.

---

## `import_project` — Existing Repo Adoption

**Trigger:** Provider tool call or `init.sh --import`
**Use case:** Adopting an existing GitHub repo into the framework.

### Steps
1. Connect the existing GitHub repo through the GitHub App.
2. Enable and validate GitHub Codespaces for the adopted repo.
3. Provision a **dedicated** Azure Container Apps environment for the project.
4. Create GitHub environments with required secrets, variables, and approval gates.
5. Validate pre-PR prerequisites: GitHub App auth, Azure OIDC trust, Container Apps environment reachability.
6. Open a **bootstrap PR** — do not modify the default branch directly.
7. Add to the bootstrap PR: `vibe.yaml`, `CLAUDE.md`, `AGENTS.md`, `.ai/context/`, `.devcontainer/devcontainer.json`, workflow wrappers, and required infra/config files.
8. After the bootstrap PR is open, GitHub Actions runs the preview workflow and deploys the first preview environment.
9. Validate the preview deployment is reachable and post status + screenshot back to the bootstrap PR.
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
- Set environment secrets and variables for Azure OIDC and Container Apps.
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
- Re-validate GitHub App auth and permissions.
- Re-validate OIDC trust.
- Re-validate backend MCP endpoint reachability.
- Re-validate Codespaces enablement for framework repo.
- Re-apply framework-level GitHub settings if missing or misconfigured.

---

## Promotion Contract

Promotion is **GitHub-owned**. The backend does not initiate deployments or release transitions.

| Transition | Owner | Mechanism |
|---|---|---|
| feature → preview | GitHub Actions | PR open/push trigger |
| preview → staging | GitHub Actions | Merge to `develop` trigger |
| staging → production | GitHub Actions + user | Merge to `main` + manual environment approval |

The backend may post status, screenshots, and metadata to PRs, but it must not autonomously merge, promote, or release.
