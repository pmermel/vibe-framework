import { z } from "zod";

const ConfigureRepoParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  approvers: z.array(z.string()).min(1),
  staging_branch: z.string().default("develop"),
  production_branch: z.string().default("main"),
});

/**
 * configureRepo
 *
 * Applies GitHub repository settings required for the vibe-framework pipeline:
 * branch protections, labels, environments (preview / staging / production),
 * and environment secrets for Azure OIDC.
 *
 * Does NOT create or modify source code in the repository.
 * Does NOT provision Azure resources — use `configureCloud` for that.
 * Does NOT open or merge pull requests.
 * Does NOT configure required status checks — check names depend on the CI workflows
 *   added after bootstrap, which are not known at bootstrap time.
 *
 * @param params - Must match `ConfigureRepoParams` schema:
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `approvers` (string[], required, min 1 — GitHub usernames for production gate)
 *   - `staging_branch` (string, optional, default `"develop"`)
 *   - `production_branch` (string, optional, default `"main"`)
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 */
export async function configureRepo(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ConfigureRepoParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const _config = parsed.data;

  // TODO: apply branch protections via GitHub App
  // TODO: create labels (feature, fix, docs, infra, chore, phase-*)
  // TODO: create environments (preview, staging, production)
  // TODO: set environment secrets and variables for Azure OIDC
  // NOTE: required_status_checks intentionally omitted — CI check names are defined
  //   by workflows added after bootstrap and cannot be known at this stage.
  // TODO: set production environment manual approval requirement
  return { status: "not_implemented" };
}
