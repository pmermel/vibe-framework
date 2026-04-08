# Stack

Technology choices for the vibe-framework and generated projects.

## Framework Backend

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | Strict mode, ESM modules |
| Runtime | Node.js 20 LTS | Required for Playwright |
| Framework | Express (minimal) | App host for health checks, smoke-test routes, and the provider-facing remote MCP transport layer |
| Headless browser | Playwright | Required for `capture_preview` action |
| Container | Docker | Multi-stage build; distroless or slim base |
| Deploy | Azure Container Apps | Consumption plan; framework-scoped environment |

## Project Templates

| Template | Stack | Adapter |
|---|---|---|
| `nextjs` | Next.js 14+, React, TypeScript | `container-app` (default) |
| `react-vite` | React, Vite, TypeScript | `static-web-app` |
| `node-api` | Node.js 20, Express, TypeScript | `container-app` (default) |

## Infrastructure

| Resource | Tool | Notes |
|---|---|---|
| IaC | Azure Bicep | Modular; one file per resource type |
| Container orchestration | Azure Container Apps | Consumption plan; per-project environments |
| Static hosting | Azure Static Web Apps | Opt-in via `adapter: static-web-app` |
| Secrets | Azure Key Vault | GitHub App private key; backend secrets |
| Auth (CI/CD) | GitHub Actions OIDC | No long-lived Azure credentials |
| Auth (repo automation) | GitHub App | No PATs |

## CI/CD

| Stage | Trigger | Target |
|---|---|---|
| Preview | PR open / push to feature branch | Ephemeral Container App revision |
| Staging | Merge to `develop` | Stable Container App (`-staging` suffix) |
| Production | Merge to `main` + manual approval | Stable Container App (`-prod` suffix) |

## Tooling

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20 LTS | Runtime and build |
| TypeScript | 5.x | Type-safe backend |
| Azure CLI | Latest | Bicep builds, local Azure ops |
| GitHub CLI (`gh`) | Latest | Issue and PR automation |
| Playwright | Latest | Headless preview screenshots |
| Bicep | Latest via Azure CLI | Infrastructure as code |

## Constraints

- Phone-first: no tool or workflow step may require a local machine to be the only path.
- Provider-neutral: no TypeScript, YAML, or shell file may import or assume a specific AI provider SDK.
- Provider-facing backend connectivity must use a standard remote MCP server interface rather than a custom REST-only contract.
- Cost-aware: preview environments must be ephemeral and cleaned up on PR close or TTL expiry.
