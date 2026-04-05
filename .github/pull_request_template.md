## Linked issue

Closes #

## What this PR does

<!-- One or two sentences. -->

## Affected journey

<!-- Which journey(s) from .ai/context/USE_CASES.md does this touch?
     Journey 1 – Bootstrap Framework
     Journey 2 – Create Project
     Journey 3 – Adopt Existing Repo
     Journey 4 – Feature Dev (Issue → Branch → PR → Preview)
     Journey 5 – Cross-Agent Handoff
     Journey 6 – Promote to Staging / Production
     None – infrastructure/tooling only -->

## Does this change a canonical workflow, contract, or intended usage?

<!-- Does this PR modify: the backend MCP contract, vibe.yaml schema, bootstrap flow,
     deployment model, branch rules, or any journey described in USE_CASES.md?
     Yes / No. If yes, describe what changed and why. -->

## Preview URL

<!-- Populated by CI after preview deployment. Leave blank until available. -->

## Screenshots

<!-- Add before/after screenshots if the change affects any rendered output. -->

## Provider and run ID

<!-- Which AI agent did this work?
     Format: Provider (Claude / Codex / other) — Run/session ID or PR branch if no ID available.
     Example: Claude Code — worktree agent-a95a53d2 -->

## Test evidence

<!-- Paste relevant test output or a link to the passing CI run.
     For backend changes: output of `cd backend && npm test`.
     For non-backend changes: describe how you verified the change. -->

## Doc updates

<!-- Check every item that applies to this PR. -->

- [ ] `plan.md` updated (if architecture or confirmed decisions changed)
- [ ] `.ai/context/` files updated (if backend contract, vibe.yaml schema, or bootstrap flow changed)
- [ ] `CLAUDE.md` updated (if Claude Code operating instructions changed)
- [ ] `AGENTS.md` updated (if Codex operating instructions changed)
- [ ] No doc updates needed — this PR does not affect any of the above

## Handoff notes

<!-- Required when handing off to another agent or leaving work in progress.
     What is done, what is left, and any risks the next agent should know about.
     Delete this section if the PR is complete and no handoff is needed. -->

## Validation checklist

- [ ] Tests pass locally (`cd backend && npm test`)
- [ ] TypeScript compiles (`cd backend && npx tsc --noEmit`)
- [ ] Lint passes (`cd backend && npm run lint`)
- [ ] CI is green on this PR
- [ ] Provider-neutral: works for both Claude and Codex agents
- [ ] No secrets or credentials in files, commits, or comments
