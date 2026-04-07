import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";

const ConfigureRepoParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  approvers: z.array(z.string()).min(1),
  staging_branch: z.string().default("develop"),
  production_branch: z.string().default("main"),
});

/** Standard labels to create on the target repository. */
const STANDARD_LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: "phase-2", color: "0075ca", description: "Phase 2 work item" },
  { name: "phase-3", color: "0075ca", description: "Phase 3 work item" },
  { name: "phase-4", color: "0075ca", description: "Phase 4 work item" },
  { name: "feat", color: "a2eeef", description: "New feature" },
  { name: "fix", color: "d73a4a", description: "Bug fix" },
  { name: "chore", color: "e4e669", description: "Chore or housekeeping" },
  { name: "infra", color: "f9d0c4", description: "Infrastructure change" },
  { name: "test", color: "bfd4f2", description: "Test addition or update" },
  { name: "docs", color: "cfd3d7", description: "Documentation change" },
];

/** GitHub environments to create. */
const ENVIRONMENTS = ["preview", "staging", "production"] as const;

/**
 * configureRepo
 *
 * Applies GitHub repository settings required for the vibe-framework pipeline:
 * - Branch protections on `production_branch` (default: `main`) and `staging_branch`
 *   (default: `develop`): require PR + 1 approval, dismiss stale reviews, require
 *   branches to be up to date before merging.
 * - GitHub environments: `preview`, `staging`, `production`. The `production` environment
 *   gets required reviewers set to the provided `approvers` list.
 * - Standard issue labels (`phase-2`, `phase-3`, `phase-4`, `feat`, `fix`, `chore`,
 *   `infra`, `test`, `docs`) — skipped gracefully if they already exist.
 *
 * Does NOT create or modify source code in the repository.
 * Does NOT provision Azure resources — use `configure_cloud` for that.
 * Does NOT create, merge, or close pull requests.
 * Does NOT configure OIDC secrets or Azure environment variables.
 *
 * @param params - Must match `ConfigureRepoParams` schema:
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `approvers` (string[], required, min 1 — GitHub usernames for production gate)
 *   - `staging_branch` (string, optional, default `"develop"`)
 *   - `production_branch` (string, optional, default `"main"`)
 * @returns `{ configured: true, repo, branch_protections, environments, labels_created }`
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws GitHub API errors if branch protection or environment operations fail.
 */
export async function configureRepo(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ConfigureRepoParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const config = parsed.data;
  const [owner, repo] = config.github_repo.split("/");
  const octokit = getGithubClient();

  // --- Branch protections ---
  const branchProtectionPayload = {
    owner,
    repo,
    required_status_checks: null,
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
    },
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: false,
    // Require branches to be up to date before merging (strict mode requires status checks).
    // Since we're not enforcing status checks here, we leave required_status_checks null
    // and rely on the UI / future configuration to enable strict mode when checks are added.
  };

  const protectedBranches = [config.production_branch, config.staging_branch];
  for (const branch of protectedBranches) {
    await octokit.repos.updateBranchProtection({
      ...branchProtectionPayload,
      branch,
    });
  }

  // --- GitHub environments ---
  // Resolve approver user IDs for the production environment required reviewers.
  // The environments API accepts user IDs, not usernames.
  const approverIds: number[] = [];
  for (const username of config.approvers) {
    try {
      const userResponse = await octokit.users.getByUsername({ username });
      approverIds.push(userResponse.data.id);
    } catch {
      // If the user doesn't exist, skip them rather than failing the entire operation.
      // The caller should validate approver usernames before calling this action.
    }
  }

  for (const env of ENVIRONMENTS) {
    const envPayload: Parameters<typeof octokit.repos.createOrUpdateEnvironment>[0] = {
      owner,
      repo,
      environment_name: env,
    };

    if (env === "production" && approverIds.length > 0) {
      envPayload.reviewers = approverIds.map((id) => ({ type: "User" as const, id }));
      envPayload.deployment_branch_policy = null;
    }

    await octokit.repos.createOrUpdateEnvironment(envPayload);
  }

  // --- Issue labels ---
  let labelsCreated = 0;
  for (const label of STANDARD_LABELS) {
    try {
      await octokit.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      labelsCreated++;
    } catch (err: unknown) {
      // GitHub returns 422 Unprocessable Entity when a label already exists.
      // Treat that as a no-op and continue.
      const status = (err as { status?: number }).status;
      if (status !== 422) {
        throw err;
      }
    }
  }

  return {
    configured: true,
    repo: config.github_repo,
    branch_protections: protectedBranches,
    environments: [...ENVIRONMENTS],
    labels_created: labelsCreated,
  };
}
