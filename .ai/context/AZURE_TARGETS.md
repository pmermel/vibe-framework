# Azure Targets

Reference for Azure resource naming, environment boundaries, and deployment targets used by the vibe-framework and generated projects.

## Environment Boundaries

| Environment | Scope | Notes |
|---|---|---|
| Framework backend | Shared across all projects | One Container Apps environment per GitHub account/org |
| Per-project | Dedicated per generated project | Isolated from framework backend and other projects |

**Projects must never deploy into the framework backend environment.**
Each `create_project` or `import_project` bootstrap provisions a new dedicated Azure Container Apps environment for that project.

## Resource Naming Conventions

| Resource | Pattern | Example |
|---|---|---|
| Resource group (framework) | `vibe-framework-rg` | `vibe-framework-rg` |
| Resource group (project) | `<project-name>-rg` | `my-app-rg` |
| Container Apps environment (framework) | `vibe-framework-env` | `vibe-framework-env` |
| Container Apps environment (project) | `<project-name>-env` | `my-app-env` |
| Backend Container App | `vibe-backend` | `vibe-backend` |
| Preview Container App | `<project-name>-pr-<pr-number>` | `my-app-pr-42` |
| Staging Container App | `<project-name>-staging` | `my-app-staging` |
| Production Container App | `<project-name>-prod` | `my-app-prod` |
| Key Vault (framework) | `vibe-framework-kv` | `vibe-framework-kv` |
| Static Web App (if adapter) | `<project-name>-swa` | `my-app-swa` |

## Azure Regions

Default region: `eastus2`

Override via `azure.region` in `vibe.yaml`.

## OIDC Trust Configuration

GitHub Actions authenticate to Azure via OIDC — no long-lived credentials stored in GitHub secrets.

Required OIDC subjects per environment:

| GitHub Environment | OIDC Subject |
|---|---|
| `preview` | `repo:<owner>/<repo>:environment:preview` |
| `staging` | `repo:<owner>/<repo>:environment:staging` |
| `production` | `repo:<owner>/<repo>:environment:production` |

OIDC federated credentials are created on the Azure service principal scoped to the resource group for each environment.

## Container Apps Configuration

- **Consumption plan** — scale to zero when idle; cost-efficient for preview environments.
- **Preview TTL** — preview Container App revisions must be deactivated and removed when the PR is closed or merged, or after the configured TTL (default: 48 hours).
- **Concurrency limit** — maximum active preview environments per project configurable in `vibe.yaml` (default: 5).
- **Ingress** — external ingress enabled; HTTPS only.

## Static Web Apps Adapter

When `adapter: static-web-app` is set in `vibe.yaml`:

- Deploy target switches from Container Apps to Azure Static Web Apps.
- Preview environments use SWA's built-in PR preview feature.
- Staging and production are separate SWA environments.
- OIDC auth still applies via Azure service principal.

## Bicep Module Structure

```
infrastructure/
├── container-apps-env.bicep       # Container Apps environment + Log Analytics
├── container-app.bicep            # Single Container App (reusable module)
├── key-vault.bicep                # Key Vault for framework secrets
├── oidc-federation.bicep          # OIDC federated credential on service principal
└── static-web-app.bicep           # Azure Static Web Apps (adapter path)
```
