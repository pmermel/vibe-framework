# GitHub App Setup

Reference for the GitHub App bootstrap sub-flow used by vibe-framework. This setup is required before the backend can automate repository creation, issue and PR updates, environment configuration, or bootstrap PR creation.

## Why This Is A Separate Sub-Flow

GitHub App setup is one of the highest-risk parts of framework bootstrap:

- It combines GitHub configuration, installation scope, private-key handling, and runtime token minting.
- It happens before the provider-tool-driven project flows can work reliably.
- If this sub-flow is incomplete, bootstrap may appear to succeed while later repo automation silently fails.

Treat GitHub App setup as a first-class bootstrap dependency rather than an implementation detail.

## Required Capabilities

The app must be able to:

- create and update repository contents
- open and update pull requests
- read and write issues and issue comments
- manage GitHub Actions settings used during bootstrap
- create and manage GitHub environments, secrets, and variables
- apply repository settings such as branch protection where required

Minimum permissions:

| Capability | Permission |
|---|---|
| Repository contents | Contents: read/write |
| Pull requests | Pull requests: read/write |
| Issues | Issues: read/write |
| Actions | Actions: read/write |
| Environments | Environments: read/write |
| Secrets and variables | Secrets and repository variables: read/write |
| Repo settings | Administration: read/write where branch protections or settings changes are required |

## Setup Flow

1. Create a new GitHub App or connect an existing app intended for vibe-framework repository automation.
2. Configure the required permissions before installation.
3. Install the app on the target user or organization.
4. Confirm the installation includes the framework repo and any repos the framework will generate or adopt.
5. Generate or rotate the GitHub App private key.
6. Store the private key in Azure Key Vault or a Container Apps secret, never in the repository.
7. At runtime, mint short-lived installation tokens from the private key and installation id.
8. Validate the token can perform one low-risk API action before depending on it for bootstrap.

## Runtime Contract

- The backend authenticates as the GitHub App, then exchanges the signed app JWT for an installation token.
- Installation tokens are short-lived and must be minted on demand.
- Repository automation must use installation tokens, not PATs.
- If the installation is missing, expired, or underscoped, bootstrap actions must fail clearly instead of falling back to weaker credentials.

## Failure Modes To Detect Early

- App exists but is not installed on the target owner or repo.
- App is installed but missing a required permission such as Actions or Environments.
- Private key is stored incorrectly or cannot be loaded by the backend runtime.
- Installation token minting works, but token scope does not allow the intended repo operation.
- Multiple app installations exist and the backend resolves the wrong installation id.

## Validation Guidance

Before broad project bootstrap work depends on the app, validate all of the following:

- The app can mint a valid installation token at runtime.
- The token can read the framework repo.
- The token can perform one safe write operation required by bootstrap, such as posting a comment or creating a test branch in a non-production context.
- The backend surfaces permission or installation failures in a way that is actionable from GitHub or logs.
