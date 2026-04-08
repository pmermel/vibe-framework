# Release Process

This document describes how vibe-framework releases are cut and how generated projects consume and upgrade framework versions.

## What a release is

A vibe-framework release is a Git tag on `main` that marks a stable, tested set of reusable workflows and backend contracts. Generated projects pin their `workflow_refs` in `vibe.yaml` to a release tag or a commit SHA. Either form is acceptable; `@main` is explicitly prohibited. Release tags are the preferred pinning mechanism because they are human-readable and stable by convention, but SHA pins are equally valid and are used when a specific commit must be targeted without waiting for a tag.

## Versioning scheme

Releases use simple integer major versions: `v1`, `v2`, etc.

A new major version is cut when:
- A reusable workflow interface changes in a breaking way (input removed, renamed, or semantics changed)
- The backend MCP contract changes in a way that requires generated projects to update their tool registration
- The `vibe.yaml` schema changes in a way that invalidates existing manifests

Non-breaking additions (new optional inputs, new optional context files, documentation updates) do not require a new major version. They are included in the existing tag's release notes as patch context if needed, but the tag itself is not moved.

## How to cut a new release

1. **Ensure `develop` is stable** — all Phase work for the release is merged to `develop`, tests pass, and the contract docs (`WORKFLOW_CONTRACT.md`, `DEPLOYMENT_CONTRACT.md`, `VIBE_YAML_SCHEMA.md`) accurately reflect the current state.

2. **Add or update release process docs if needed** — if the release process itself is changing, update this file in a branch → PR → `develop` before promoting.

3. **Promote `develop` → `main` via PR**
   ```
   base: main
   head: develop
   title: chore(release): promote develop to main for vN
   ```
   Merge only after review. No direct commits to `main`.

4. **Create the tag on `main`**
   ```bash
   git checkout main && git pull origin main
   git tag vN
   git push origin vN
   ```

5. **Create a GitHub release from the tag**
   - Go to Releases → Draft a new release → select the tag
   - Title: `vN`
   - Body: summarize what's new, what's breaking (if any), and the upgrade path for generated projects
   - Publish the release

6. **Update the framework's own `vibe.yaml`** to reference the new tag in `workflow_refs` if the framework dogfoods its own workflows.

7. **Close the release tracking issue** if one exists.

## How generated projects upgrade

Generated projects control their framework version through `workflow_refs` in `vibe.yaml`:

```yaml
github:
  workflow_refs:
    preview: pmermel/vibe-framework/.github/workflows/reusable-preview.yml@v1
    staging: pmermel/vibe-framework/.github/workflows/reusable-staging.yml@v1
    production: pmermel/vibe-framework/.github/workflows/reusable-production.yml@v1
    preview_ttl_cleanup: pmermel/vibe-framework/.github/workflows/reusable-preview-ttl-cleanup.yml@v1
```

To upgrade to a new framework version:

1. Bump the ref in all `workflow_refs` entries to the new tag (e.g. `@v1` → `@v2`) or a specific commit SHA.
2. Review the release notes for any breaking changes or required `vibe.yaml` schema updates.
3. Re-run bootstrap automation — it reads `workflow_refs` and regenerates thin wrapper workflow files in `.github/workflows/`.
4. Open a PR with the updated `vibe.yaml` and regenerated wrappers for review before merging.

Upgrades are always intentional. Generated projects never auto-pull `@main` or receive silent updates.

## Rules

- Tags are never moved after creation. If a release has a critical bug, cut a new tag.
- `@main` refs are prohibited in generated project `vibe.yaml` files and are rejected by CI.
- The framework's own `vibe.yaml` must also follow pinned-ref rules.
