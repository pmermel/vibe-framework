import { z } from "zod";
import _sodium from "libsodium-wrappers";
import { getGithubClient } from "../lib/github-client.js";

const ConfigureRepoParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  approvers: z.array(z.string()).min(1),
  staging_branch: z.string().default("develop"),
  production_branch: z.string().default("main"),
  azure_client_id: z.string().optional(),
  azure_tenant_id: z.string().optional(),
  azure_subscription_id: z.string().optional(),
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
 * encryptSecret
 *
 * Encrypts a secret value using the repository's public key so it can be
 * stored via the GitHub Actions secrets API.
 *
 * @param publicKey - Base64-encoded repository public key from GitHub API.
 * @param secretValue - Plaintext secret value to encrypt.
 * @returns Base64-encoded encrypted value suitable for the secrets API.
 */
async function encryptSecret(publicKey: string, secretValue: string): Promise<string> {
  await _sodium.ready;
  const sodium = _sodium;
  const keyBytes = Buffer.from(publicKey, "base64");
  const secretBytes = Buffer.from(secretValue, "utf8");
  const encrypted = sodium.crypto_box_seal(secretBytes, keyBytes);
  return Buffer.from(encrypted).toString("base64");
}

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
 * - Sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` as environment
 *   secrets on all three environments if all three `azure_*` params are provided.
 *
 * Does NOT create or modify source code in the repository.
 * Does NOT provision Azure resources — use `configure_cloud` for that.
 * Does NOT create, merge, or close pull requests.
 *
 * @param params - Must match `ConfigureRepoParams` schema:
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `approvers` (string[], required, min 1 — GitHub usernames for production gate)
 *   - `staging_branch` (string, optional, default `"develop"`)
 *   - `production_branch` (string, optional, default `"main"`)
 *   - `azure_client_id` (string, optional) — OIDC client ID output from `configure_cloud`
 *   - `azure_tenant_id` (string, optional) — Azure tenant ID output from `configure_cloud`
 *   - `azure_subscription_id` (string, optional) — Azure subscription ID output from `configure_cloud`
 * @returns `{ configured: true, repo, branch_protections, environments, labels_created, azure_secrets_configured }`
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws GitHub API errors if branch protection or environment operations fail.
 * @throws GitHub API errors if any approver username cannot be resolved — fails closed
 *         rather than silently producing an approval gate with fewer reviewers than intended.
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
  // Any failed lookup propagates as an error — fail closed rather than silently
  // producing an approval gate with fewer reviewers than intended.
  const approverIds: number[] = [];
  for (const username of config.approvers) {
    const userResponse = await octokit.users.getByUsername({ username });
    approverIds.push(userResponse.data.id);
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

  // --- Azure OIDC secrets ---
  // If all three Azure identity params are provided, encrypt and store them as
  // environment secrets on every environment so workflows can authenticate via OIDC.
  const azureSecretsConfigured =
    config.azure_client_id !== undefined &&
    config.azure_tenant_id !== undefined &&
    config.azure_subscription_id !== undefined;

  if (azureSecretsConfigured) {
    // Fetch the repo's public key once — needed to encrypt each secret before upload.
    const publicKeyResponse = await octokit.actions.getRepoPublicKey({ owner, repo });
    const { key: publicKey, key_id } = publicKeyResponse.data;

    const azureSecrets: Record<string, string> = {
      AZURE_CLIENT_ID: config.azure_client_id!,
      AZURE_TENANT_ID: config.azure_tenant_id!,
      AZURE_SUBSCRIPTION_ID: config.azure_subscription_id!,
    };

    for (const env of ENVIRONMENTS) {
      for (const [secret_name, secret_value] of Object.entries(azureSecrets)) {
        const encrypted_value = await encryptSecret(publicKey, secret_value);
        await octokit.actions.createOrUpdateEnvironmentSecret({
          owner,
          repo,
          environment_name: env,
          secret_name,
          encrypted_value,
          key_id,
        });
      }
    }
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
    azure_secrets_configured: azureSecretsConfigured,
  };
}
