# Conventions

Shared coding and workflow conventions for all agents working in this repository or any project generated from this framework.

## Branching

- Branch from `develop` for all work.
- Branch naming: `feature/<topic>`, `fix/<topic>`, `docs/<topic>`, `infra/<topic>`, `chore/<topic>`.
- One active writer per branch at a time.
- Handoff comment required before a second agent pushes to an active branch.

## Commits

Follow Conventional Commits:

```
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `docs`, `chore`, `infra`, `test`, `refactor`

- One logical change per commit.
- If the message needs "and", split the commit.

## Pull Requests

- Every change merges via PR — no direct commits to `develop` or `main`.
- PR title follows the same Conventional Commits format as commit messages.
- Link to the GitHub Issue: `Closes #N` in the PR body.
- PR body must include: linked issue, preview URL (once available), provider/run ID, handoff notes if applicable.

## Work Queue

- GitHub Issues are the task queue.
- Claim an issue by commenting: `Claimed by <provider> — starting branch feature/<topic>`.
- Post a status comment when blocked or done.

## File Ownership

- `vibe.yaml` — project config, provider-neutral, no secrets.
- `CLAUDE.md` — Claude Code instructions only, no canonical config.
- `AGENTS.md` — Codex instructions only, no canonical config.
- `.ai/context/` — shared conventions readable by both providers.
- `.devcontainer/` — Codespaces config, used by Claude Code path.

## Provider Neutrality

- No provider-specific fields in `vibe.yaml`.
- All workflow actions and backend tool names must work from either provider.
- GitHub is the handoff layer — either provider must be able to resume any branch cold.

## Testing

Every PR that adds or changes backend logic must include tests.

- **Framework**: vitest (`cd backend && npm test`)
- **File placement**: `src/foo.ts` → `src/foo.test.ts` (co-located, not a separate `__tests__` directory)
- **Required coverage for new actions**:
  - Valid params → 200 with `{ ok: true }`
  - Missing required params → 400
  - Invalid enum or format → 400
  - Unknown action name → 404
- **Required coverage for new handler paths**: happy path and each distinct error branch
- Tests must pass locally before the PR is opened. Failing tests block merge.

## Documentation

Every PR that adds or changes backend logic must include inline documentation.

- JSDoc comment on every exported function.
- Comment must state: what the function does, what it does NOT do (e.g. "does not deploy"), and any constraints.
- If a change affects the backend contract, `vibe.yaml` schema, or bootstrap flow, update the relevant `.ai/context/` file in the same PR.

## Secrets and Credentials

- No secrets in files, commits, or comments.
- Azure credentials via GitHub Actions OIDC only.
- GitHub App private key stored in Azure Key Vault or Container Apps secret.
- No PATs — use the GitHub App for all repo automation.
