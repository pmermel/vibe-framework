# Workflow Caller Contract

Reference for the four reusable GitHub Actions workflows provided by vibe-framework. Generated project repos call these as thin wrappers using `secrets: inherit`. Pinned refs are stored in `vibe.yaml` under `github.workflow_refs`.

---

## `reusable-preview.yml`

**Ref:** `pmermel/vibe-framework/.github/workflows/reusable-preview.yml@v1`
**Trigger:** `pull_request` events (`opened`, `synchronize`, `reopened`, `closed`)
**GitHub Environment:** `preview` (no approval gate; used to scope OIDC token subject and environment-scoped secrets — does not pause the workflow)
**Concurrency:** One active deploy per PR; new pushes cancel the in-progress run.

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

### Secrets

| Name | Required | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | yes | Service principal client ID for OIDC login |
| `AZURE_TENANT_ID` | yes | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | yes | Azure subscription ID |

### Outputs

| Name | Description |
|---|---|
| `preview_url` | HTTPS URL of the deployed preview environment |

### Permissions Required

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |
| `pull-requests: write` | Post/update preview URL comment on the PR |

### Behavior Summary

- `deploy` job runs on PR open/synchronize/reopen; `cleanup` job runs on PR close.
- Builds image via `az acr build` (no local Docker required) and tags it `pr-<N>`.
- On first deploy for a PR: creates ephemeral Container App with a public placeholder, assigns system identity, grants AcrPull, waits 60 s for IAM propagation, then updates to the private image.
- On subsequent pushes: updates the existing Container App image only (identity and AcrPull already set).
- Posts a `<!-- vibe-preview-url -->` comment to the PR; subsequent pushes update the same comment.
- On PR close: deletes the Container App and the `pr-<N>` ACR image.

### Thin Wrapper Example

```yaml
# .github/workflows/preview.yml (in generated project repo)
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    uses: pmermel/vibe-framework/.github/workflows/reusable-preview.yml@v1
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

**Ref:** `pmermel/vibe-framework/.github/workflows/reusable-staging.yml@v1`
**Trigger:** Push to the staging branch (default: `develop`)
**GitHub Environment:** `staging` (no approval gate; used to scope OIDC token subject and environment-scoped secrets — does not pause the workflow)

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

### Secrets

| Name | Required | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | yes | Service principal client ID for OIDC login |
| `AZURE_TENANT_ID` | yes | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | yes | Azure subscription ID |

### Outputs

| Name | Description |
|---|---|
| `staging_url` | HTTPS URL of the staging environment |

### Permissions Required

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |

### Behavior Summary

- Builds and pushes image tagged `:staging` (overwritten on every push to the staging branch).
- Calls `az containerapp update` on the pre-provisioned staging Container App.
- The staging Container App must already exist (provisioned by Bicep during bootstrap).
- Staging Container App has managed identity and AcrPull assigned at provision time — no runtime identity wiring needed.

### Thin Wrapper Example

```yaml
# .github/workflows/staging.yml (in generated project repo)
on:
  push:
    branches: [develop]

jobs:
  staging:
    uses: pmermel/vibe-framework/.github/workflows/reusable-staging.yml@v1
    with:
      app_name: my-app
      resource_group: my-app-rg
      staging_app: my-app-staging
      registry: myappacr
    secrets: inherit
```

---

## `reusable-production.yml`

**Ref:** `pmermel/vibe-framework/.github/workflows/reusable-production.yml@v1`
**Trigger:** Push to the production branch (default: `main`)
**GitHub Environment:** `production` (approval gate — pauses until a required reviewer approves)

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

### Secrets

| Name | Required | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | yes | Service principal client ID for OIDC login |
| `AZURE_TENANT_ID` | yes | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | yes | Azure subscription ID |

### Outputs

| Name | Description |
|---|---|
| `production_url` | HTTPS URL of the production environment |

### Permissions Required

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Checkout |

### Behavior Summary

- The `deploy` job declares `environment: production`, which causes GitHub to enforce the approval gate before any steps run.
- Required reviewers come from `approvers` in `vibe.yaml`, applied to the GitHub environment by bootstrap automation.
- Builds image tagged `:latest` from the production branch (not promoted from `:staging`).
- Calls `az containerapp update` on the pre-provisioned production Container App.
- Production Container App must already exist (provisioned by Bicep during bootstrap).
- Staging image is NOT promoted; a fresh build from `main` is always used.

### Thin Wrapper Example

```yaml
# .github/workflows/production.yml (in generated project repo)
on:
  push:
    branches: [main]

jobs:
  production:
    uses: pmermel/vibe-framework/.github/workflows/reusable-production.yml@v1
    with:
      app_name: my-app
      resource_group: my-app-rg
      production_app: my-app-prod
      registry: myappacr
    secrets: inherit
```

---

## `reusable-preview-ttl-cleanup.yml`

**Ref:** `pmermel/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@v1`
**Trigger:** `schedule` (cron in the calling wrapper)
**GitHub Environment:** none

### Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `resource_group` | string | yes | — | Azure resource group to scan for stale preview Container Apps |
| `preview_app_prefix` | string | yes | — | Prefix used to identify preview Container Apps (e.g. `my-app-pr`) |
| `registry` | string | yes | — | Azure Container Registry name (without `.azurecr.io`) |
| `app_name` | string | yes | — | Project name; used to identify PR-tagged images in ACR |
| `max_age_days` | number | no | `7` | Delete preview apps and images older than this many days |

### Secrets

| Name | Required | Description |
|---|---|---|
| `AZURE_CLIENT_ID` | yes | Service principal client ID for OIDC login |
| `AZURE_TENANT_ID` | yes | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | yes | Azure subscription ID |

### Outputs

None.

### Permissions Required

| Permission | Reason |
|---|---|
| `id-token: write` | OIDC token exchange with Azure |
| `contents: read` | Required by azure/login action |

### Behavior Summary

- Lists all Container Apps in the resource group whose names start with `preview_app_prefix-`.
- Deletes apps whose `systemData.createdAt` is older than `max_age_days`.
- For each deleted app, also deletes the corresponding `pr-<N>` ACR image.
- Idempotent; safe to run even if no stale apps exist.
- Handles abandoned branches and PRs that bypassed the PR-close cleanup path.

### Thin Wrapper Example

```yaml
# .github/workflows/preview-ttl-cleanup.yml (in generated project repo)
on:
  schedule:
    - cron: '0 3 * * 0'  # every Sunday at 03:00 UTC

jobs:
  ttl-cleanup:
    uses: pmermel/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@v1
    with:
      resource_group: my-app-rg
      preview_app_prefix: my-app-pr
      registry: myappacr
      app_name: my-app
      max_age_days: 7
    secrets: inherit
```
