# Workflow Caller Contract

Authoritative reference for the four reusable GitHub Actions workflows provided by vibe-framework. Generated project repos call these as thin wrapper workflows using `secrets: inherit`. Pinned refs live in `vibe.yaml` under `github.workflow_refs` and must never be `@main`.

This document supersedes `WORKFLOW_CALLER_CONTRACT.md`, which it replaces with full caller contract coverage including caller/framework boundaries, vibe.yaml field requirements, and customization rules.

---

## Provider Neutrality

These workflow contracts apply equally regardless of which provider (Claude Code or Codex) triggered the underlying work. The workflows are invoked by GitHub Actions, not by providers directly. Providers interact with them by pushing to branches or opening PRs — neither provider needs provider-specific workflow logic.

---

## vibe.yaml Fields Read by Wrapper Generation

Bootstrap automation generates the thin wrapper files from `vibe.yaml`. The following fields determine which values appear in the generated wrappers:

| vibe.yaml field | Consumed by |
|---|---|
| `github.workflow_refs.preview` | `preview.yml` wrapper `uses:` ref |
| `github.workflow_refs.staging` | `staging.yml` wrapper `uses:` ref |
| `github.workflow_refs.production` | `production.yml` wrapper `uses:` ref |
| `github.workflow_refs.preview_ttl_cleanup` | `preview-ttl-cleanup.yml` wrapper `uses:` ref |
| `azure.resource_group` | All four wrappers — passed as `resource_group` input |
| `azure.registry` | All four wrappers — passed as `registry` input |
| `azure.container_app_environment` | Preview wrapper — passed as `container_app_environment` input |
| `azure.preview_app_prefix` | Preview and TTL cleanup wrappers — passed as `preview_app_prefix` input |
| `azure.staging_app` | Staging wrapper — passed as `staging_app` input |
| `azure.production_app` | Production wrapper — passed as `production_app` input |
| `name` | All four wrappers — passed as `app_name` input |
| `build.install` | All four wrappers — passed as `install_command` input (if non-default) |
| `build.build` | All four wrappers — passed as `build_command` input (if non-default) |
| `deploy.preview.max_concurrent` | Passed as `max_concurrent` to `reusable-preview.yml`; enforced before each new preview deploy |
| `deploy.preview.ttl_hours` | Converted to days for `max_age_days` in TTL cleanup wrapper |
| `branch_policy.staging` | Staging wrapper `on.push.branches` |
| `branch_policy.production` | Production wrapper `on.push.branches` |
| `approvers` | `production` GitHub environment required reviewers — set by bootstrap, not the workflow itself |

---

## Caller Customization Rules

### What callers MAY customize

Callers (generated project wrappers) may set any workflow `input` declared by the reusable workflow. The following are the most common customization points:

| Input | Default | When to override |
|---|---|---|
| `dockerfile` | `./Dockerfile` | Non-standard Dockerfile path |
| `install_command` | `npm ci` | Non-Node runtimes or monorepos |
| `build_command` | `npm run build` | Custom build scripts |
| `target_port` | `3000` | Non-standard application port (preview only) |
| `max_concurrent` | `3` | Project-specific concurrent preview limit (preview only) |
| `max_age_days` | `7` | Project-specific TTL cleanup schedule |

Callers MAY adjust the `on:` trigger (e.g., branch name, cron schedule) so long as the trigger type matches the workflow contract below.

### What callers MUST NOT change

| Rule | Rationale |
|---|---|
| Must use `secrets: inherit` — never pass individual secret values | Secrets are environment-scoped and inherited from GitHub environment context; passing values manually breaks the OIDC scoping model |
| Must not add `permissions:` block to the calling job | The reusable workflow declares its own permissions; overriding them can break OIDC token exchange |
| Must not bypass the `environment:` key in the reusable jobs | Removing `environment:` breaks OIDC trust scoping and disables the production approval gate |
| Must not set `runs-on:` in the calling job | The reusable workflow controls the runner; callers do not have a `runs-on` for `uses:` jobs |
| Must pin the `uses:` ref to a release tag or SHA — never `@main` | `@main` would silently pull breaking changes into generated projects |
| Must not duplicate the `concurrency:` key | Concurrency is managed inside the reusable preview workflow to prevent parallel builds per PR |

---

## `reusable-preview.yml`

**File:** `.github/workflows/reusable-preview.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-preview.yml@<tag>`
**Trigger:** `pull_request` events — `opened`, `synchronize`, `reopened`, `closed`
**GitHub Environment:** `preview` (OIDC trust scoping only — no approval gate)
**Concurrency:** One active deploy per PR (`cancel-in-progress: true`); controlled by the reusable workflow, not the caller

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name; used for ACR image tags and Container App naming |
| `resource_group` | string | yes | — | Azure resource group containing the Container Apps environment |
| `container_app_environment` | string | yes | — | Name of the Azure Container Apps managed environment |
| `preview_app_prefix` | string | yes | — | Prefix for ephemeral preview Container Apps (e.g. `my-app-pr` → `my-app-pr-42`) |
| `registry` | string | yes | — | Azure Container Registry name (without `.azurecr.io`) |
| `dockerfile` | string | no | `./Dockerfile` | Path to Dockerfile relative to repo root |
| `install_command` | string | no | `npm ci` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |
| `target_port` | number | no | `3000` | Port the container listens on |
| `max_concurrent` | number | no | `3` | Maximum number of active preview Container Apps. When this limit is reached, the oldest preview is deleted before the new one is deployed. Set from `vibe.yaml deploy.preview.max_concurrent`. |

### Required Secrets

All three secrets must be set on the `preview` GitHub environment. Callers pass them via `secrets: inherit`.

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `preview` environment — output of `oidc-federated-credential.bicep` deployed for `githubEnvironment: preview` |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Required GitHub Environment

| Environment name | Approval gate | OIDC subject |
|---|---|---|
| `preview` | None | `repo:<owner>/<repo>:environment:preview` |

### Outputs

| Name | Description |
|---|---|
| `preview_url` | HTTPS URL of the deployed ephemeral Container App |

### Permissions Declared (inside reusable workflow)

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |
| `pull-requests: write` | Post/update preview URL comment on the PR |

### Behavior

**deploy job** (runs on open/synchronize/reopen):

- Builds image via `az acr build` (no local Docker daemon required), tagged `pr-<N>`.
- First deploy for a PR: creates Container App with a public placeholder image, system identity, AcrPull role grant, 60-second IAM propagation wait, then updates to the private image.
- Subsequent pushes: updates existing Container App image only — identity and AcrPull already present.
- Posts a `<!-- vibe-preview-url -->` comment to the PR; subsequent pushes update the same comment rather than creating duplicates.

**cleanup job** (runs on PR close, merged or abandoned):

- Deletes the ephemeral Container App and the `pr-<N>` ACR image tag.
- Idempotent: no-ops if the preview was already deleted (e.g., by TTL cleanup).

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/preview.yml
# Generated by bootstrap automation from vibe.yaml github.workflow_refs.preview
# DO NOT edit the `uses:` ref manually — update vibe.yaml and re-run bootstrap.
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-preview.yml@v1
    with:
      app_name: my-app
      resource_group: my-app-rg
      container_app_environment: my-app-env
      preview_app_prefix: my-app-pr
      registry: myappacr
    secrets: inherit
```

---

## `reusable-staging.yml`

**File:** `.github/workflows/reusable-staging.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-staging.yml@<tag>`
**Trigger:** Push to the staging branch (default: `develop`, from `vibe.yaml branch_policy.staging`)
**GitHub Environment:** `staging` (OIDC trust scoping only — no approval gate)

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name; used for ACR image tags |
| `resource_group` | string | yes | — | Azure resource group containing the staging Container App |
| `staging_app` | string | yes | — | Name of the staging Container App |
| `registry` | string | yes | — | Azure Container Registry name (without `.azurecr.io`) |
| `dockerfile` | string | no | `./Dockerfile` | Path to Dockerfile relative to repo root |
| `install_command` | string | no | `npm ci` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |

### Required Secrets

All three secrets must be set on the `staging` GitHub environment.

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `staging` environment |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Required GitHub Environment

| Environment name | Approval gate | OIDC subject |
|---|---|---|
| `staging` | None | `repo:<owner>/<repo>:environment:staging` |

### Required Pre-existing Azure Resources

The staging Container App must already exist before the workflow runs. Bootstrap automation provisions it via `infrastructure/container-apps-env.bicep`. The workflow calls `az containerapp update` and will fail if the app does not exist.

### Outputs

| Name | Description |
|---|---|
| `staging_url` | HTTPS URL of the staging Container App |

### Permissions Declared (inside reusable workflow)

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |

### Behavior

- Builds and pushes image tagged `:staging` to ACR (overwrites the previous `:staging` tag on every push).
- Calls `az containerapp update` on the pre-provisioned staging Container App.
- Managed identity and AcrPull are assigned at Bicep provision time — no runtime identity wiring.

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/staging.yml
# Generated by bootstrap automation from vibe.yaml github.workflow_refs.staging
on:
  push:
    branches: [develop]  # matches vibe.yaml branch_policy.staging

jobs:
  staging:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-staging.yml@v1
    with:
      app_name: my-app
      resource_group: my-app-rg
      staging_app: my-app-staging
      registry: myappacr
    secrets: inherit
```

---

## `reusable-production.yml`

**File:** `.github/workflows/reusable-production.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-production.yml@<tag>`
**Trigger:** Push to the production branch (default: `main`, from `vibe.yaml branch_policy.production`)
**GitHub Environment:** `production` (approval gate — pauses the job until a required reviewer approves)

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name; used for ACR image tags |
| `resource_group` | string | yes | — | Azure resource group containing the production Container App |
| `production_app` | string | yes | — | Name of the production Container App |
| `registry` | string | yes | — | Azure Container Registry name (without `.azurecr.io`) |
| `dockerfile` | string | no | `./Dockerfile` | Path to Dockerfile relative to repo root |
| `install_command` | string | no | `npm ci` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |

### Required Secrets

All three secrets must be set on the `production` GitHub environment.

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `production` environment |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Required GitHub Environment

| Environment name | Approval gate | OIDC subject |
|---|---|---|
| `production` | Required — set by bootstrap automation using `approvers` from `vibe.yaml` | `repo:<owner>/<repo>:environment:production` |

The approval gate is what pauses the deploy job before any Azure commands run. Promotion is GitHub-owned: neither the backend nor a provider autonomously initiates production releases.

### Required Pre-existing Azure Resources

The production Container App must already exist before the workflow runs. Provisioned by `infrastructure/container-apps-env.bicep` during project bootstrap.

### Outputs

| Name | Description |
|---|---|
| `production_url` | HTTPS URL of the production Container App |

### Permissions Declared (inside reusable workflow)

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |

### Behavior

- The `deploy` job declares `environment: production`. GitHub enforces the approval gate before any steps run.
- Builds image tagged `:latest` from the production branch (not promoted from `:staging`). This ensures the production build always reflects the exact code in `main`.
- Calls `az containerapp update` on the pre-provisioned production Container App.
- Managed identity and AcrPull are assigned at Bicep provision time — no runtime identity wiring.

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/production.yml
# Generated by bootstrap automation from vibe.yaml github.workflow_refs.production
on:
  push:
    branches: [main]  # matches vibe.yaml branch_policy.production

jobs:
  production:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-production.yml@v1
    with:
      app_name: my-app
      resource_group: my-app-rg
      production_app: my-app-prod
      registry: myappacr
    secrets: inherit
```

---

## `reusable-preview-ttl-cleanup.yml`

**File:** `.github/workflows/reusable-preview-ttl-cleanup.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@<tag>`
**Trigger:** `schedule` — cron expression set by the caller; not driven by a PR event
**GitHub Environment:** `preview` — uses the same OIDC credentials as the preview deploy workflow

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `resource_group` | string | yes | — | Azure resource group to scan for stale preview Container Apps |
| `preview_app_prefix` | string | yes | — | Prefix identifying preview Container Apps (e.g. `my-app-pr`) |
| `registry` | string | yes | — | Azure Container Registry name (without `.azurecr.io`) |
| `app_name` | string | yes | — | Project name; identifies PR-tagged images in ACR |
| `max_age_days` | number | no | `7` | Delete preview apps and images older than this many days |

The `max_age_days` default (7 days) is intentionally more aggressive than the `vibe.yaml` `deploy.preview.ttl_hours` default (48 hours). The TTL cleanup workflow is a backstop for abandoned previews, not the primary cleanup path. PR-close cleanup (in `reusable-preview.yml`) is the primary path.

To align with `vibe.yaml`, bootstrap automation converts `deploy.preview.ttl_hours / 24` to `max_age_days` when generating this wrapper, rounding up to the nearest whole day.

### Required Secrets

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `preview` environment — same credential used by the preview deploy workflow |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

The TTL cleanup workflow runs in the `preview` GitHub environment so the OIDC subject matches `environment:preview` — the same trust scope used by the preview deploy workflow. Callers must use `secrets: inherit`; secrets are inherited from the `preview` environment context, not from the repository level. No separate credential path is needed.

### Required GitHub Environment

| Environment name | Approval gate | OIDC subject |
|---|---|---|
| `preview` | None | `repo:<owner>/<repo>:environment:preview` |

### Outputs

None.

### Permissions Declared (inside reusable workflow)

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Required by `azure/login` action |

### Behavior

- Lists all Container Apps in `resource_group` whose names start with `preview_app_prefix-`.
- Deletes those whose `systemData.createdAt` is older than `max_age_days`.
- For each deleted app, also deletes the corresponding `pr-<N>` ACR image tag.
- Idempotent — safe to run when no stale apps exist.
- Handles previews from abandoned branches and PRs that bypassed the PR-close cleanup job.

### Thin Wrapper (generated project pattern)

The `preview` environment is declared **inside** `reusable-preview-ttl-cleanup.yml` on its own job, not in the caller. GitHub's reusable-workflow model does not support `environment:` on a `uses:` calling job — the environment must live inside the reusable workflow itself. Callers therefore only need `secrets: inherit`; the OIDC trust is correctly scoped to `environment:preview` by the reusable workflow job.

```yaml
# .github/workflows/preview-ttl-cleanup.yml
# Generated by bootstrap automation from vibe.yaml github.workflow_refs.preview_ttl_cleanup
# Cron derived from vibe.yaml deploy.preview.ttl_hours (48h → daily at 03:00 UTC)
on:
  schedule:
    - cron: '0 3 * * *'  # daily at 03:00 UTC; adjust to match vibe.yaml ttl_hours

jobs:
  ttl-cleanup:
    # environment: preview is NOT set here — it is declared inside the reusable workflow
    # job itself, which is the correct place for GitHub's reusable-workflow model.
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@v1
    with:
      resource_group: my-app-rg
      preview_app_prefix: my-app-pr
      registry: myappacr
      app_name: my-app
      max_age_days: 2  # ceil(48h / 24) = 2 days; from vibe.yaml deploy.preview.ttl_hours
    secrets: inherit
```

---

## Wrapper Generation Rules

Bootstrap automation (via `create_project` or `import_project`) generates the four wrapper files above from `vibe.yaml`. The following rules apply:

1. **The `uses:` ref is always taken verbatim from `vibe.yaml github.workflow_refs.*`** — never hardcoded by bootstrap logic.
2. **All four wrappers are generated in `.github/workflows/`** of the project repo with filenames `preview.yml`, `staging.yml`, `production.yml`, and `preview-ttl-cleanup.yml`.
3. **Wrappers are never manually edited.** To change a pinned ref, update `vibe.yaml` and re-run bootstrap or the relevant bootstrap action.
4. **The `on:` trigger branch names come from `vibe.yaml branch_policy`**, not from framework defaults.
5. **`secrets: inherit` is always used.** Individual secret values are never hardcoded into wrappers.

---

## `reusable-swa-preview.yml`

**File:** `.github/workflows/reusable-swa-preview.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-swa-preview.yml@<tag>`
**Trigger:** `pull_request` events — `opened`, `synchronize`, `reopened`, `closed`
**GitHub Environment:** `preview` (OIDC trust scoping — no approval gate)

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name |
| `resource_group` | string | yes | — | Azure resource group containing the Static Web App |
| `swa_name` | string | yes | — | Azure Static Web App resource name (e.g. `my-app-swa`) |
| `install_command` | string | no | `npm install` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |
| `output_location` | string | no | `dist` | Build output directory relative to repo root |

### Required Secrets

All three secrets must be set on the `preview` GitHub environment. Callers pass them via `secrets: inherit`.

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `preview` environment |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

No `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is needed. The deployment token is fetched at runtime via `az staticwebapp secrets list` after OIDC login.

### Behavior

**deploy job** (runs when `github.event.action != 'closed'`):
- Checks out, installs, and builds the app.
- Logs in to Azure via OIDC (`azure/login@v2`).
- Fetches the SWA deployment token at runtime: `az staticwebapp secrets list --name <swa_name> --resource-group <resource_group>`.
- Deploys to a PR-specific preview environment via `Azure/static-web-apps-deploy@v1` (`action: upload`).
- SWA natively creates a named preview environment per PR and posts the URL to the PR automatically.

**close job** (runs when `github.event.action == 'closed'`):
- Logs in to Azure via OIDC, fetches the SWA deployment token, then calls `Azure/static-web-apps-deploy@v1` with `action: close` to tear down the PR's preview environment.
- This is the primary cleanup path — no TTL cleanup workflow is needed for SWA.

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/preview.yml
name: Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: ['**']

jobs:
  preview:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-swa-preview.yml@v1
    with:
      app_name: my-site
      resource_group: my-site-rg
      swa_name: my-site-swa
      install_command: npm install
      build_command: npm run build
    secrets: inherit
```

---

## `reusable-swa-staging.yml`

**File:** `.github/workflows/reusable-swa-staging.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-swa-staging.yml@<tag>`
**Trigger:** Push to the staging branch (default: `develop`, from `vibe.yaml branch_policy.staging`)
**GitHub Environment:** `staging` (OIDC trust scoping — no approval gate)

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name |
| `resource_group` | string | yes | — | Azure resource group containing the Static Web App |
| `swa_name` | string | yes | — | Azure Static Web App resource name |
| `install_command` | string | no | `npm install` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |
| `output_location` | string | no | `dist` | Build output directory |

### Required Secrets

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `staging` environment |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Behavior

- Checks out, installs, builds.
- Logs in to Azure via OIDC.
- Fetches SWA deployment token at runtime.
- Deploys to the `staging` named environment via `Azure/static-web-apps-deploy@v1` (`action: upload`, `deployment_environment: staging`).

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/staging.yml
name: Staging
on:
  push:
    branches: [develop]

jobs:
  staging:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-swa-staging.yml@v1
    with:
      app_name: my-site
      resource_group: my-site-rg
      swa_name: my-site-swa
      install_command: npm install
      build_command: npm run build
    secrets: inherit
```

---

## `reusable-swa-production.yml`

**File:** `.github/workflows/reusable-swa-production.yml`
**Ref pattern:** `<framework-owner>/vibe-framework/.github/workflows/reusable-swa-production.yml@<tag>`
**Trigger:** Push to the production branch (default: `main`, from `vibe.yaml branch_policy.production`)
**GitHub Environment:** `production` (approval gate — pauses the job until a required reviewer approves)

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `app_name` | string | yes | — | Project name |
| `resource_group` | string | yes | — | Azure resource group containing the Static Web App |
| `swa_name` | string | yes | — | Azure Static Web App resource name |
| `install_command` | string | no | `npm install` | Dependency install command |
| `build_command` | string | no | `npm run build` | Application build command |
| `output_location` | string | no | `dist` | Build output directory |

### Required Secrets

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the service principal for the `production` environment |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

### Behavior

- The `production` job declares `environment: production`. GitHub enforces the approval gate before any steps run.
- Checks out, installs, builds.
- Logs in to Azure via OIDC.
- Fetches SWA deployment token at runtime.
- Deploys to the SWA production slot via `Azure/static-web-apps-deploy@v1` (`action: upload`, no `deployment_environment` — production deploys to the default slot).

### Thin Wrapper (generated project pattern)

```yaml
# .github/workflows/production.yml
name: Production
on:
  push:
    branches: [main]

jobs:
  production:
    uses: YOUR_GITHUB_USERNAME/vibe-framework/.github/workflows/reusable-swa-production.yml@v1
    with:
      app_name: my-site
      resource_group: my-site-rg
      swa_name: my-site-swa
      install_command: npm install
      build_command: npm run build
    secrets: inherit
```

---

## Workflow Upgrade Path

To upgrade a generated project to a newer framework workflow release:

1. Update `vibe.yaml github.workflow_refs.*` to point to the new tag (e.g., `@v2`).
2. Run `bootstrap_framework` or the relevant wrapper-regeneration command.
3. Open a PR with the updated wrapper files and validate preview deployment against the new workflow version before merging.

Pinned tags prevent unintentional upgrades. Projects upgrade only when explicitly changed.
