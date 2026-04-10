import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";
import { generateNextjsScaffold } from "../scaffold/nextjs.js";
import { configureCloud } from "./configure-cloud.js";
import { configureRepo } from "./configure-repo.js";

const ImportProjectParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  azure_region: z.string().default("eastus2"),
  azure_subscription_id: z.string().optional(),
  approvers: z.array(z.string()).min(1),
  framework_repo: z.string().default("pmermel/vibe-framework"),
  template: z.enum(["nextjs"]).default("nextjs"),
});

/**
 * Framework-level files to include in the adoption commit.
 * These are the keys from generateNextjsScaffold() that are safe to add to
 * an existing repo without overwriting application code.
 *
 * Excluded paths (application code that must never be overwritten):
 *   src/, public/, package.json, tsconfig.json, next.config.*, Dockerfile,
 *   tailwind.config.*, postcss.config.*, .gitignore, README.md
 */
const FRAMEWORK_FILE_PREFIXES = [
  "vibe.yaml",
  "CLAUDE.md",
  "AGENTS.md",
  ".ai/",
  ".devcontainer/",
  ".github/",
  "infrastructure/",
];

function isFrameworkFile(filePath: string): boolean {
  return FRAMEWORK_FILE_PREFIXES.some(
    (prefix) => filePath === prefix || filePath.startsWith(prefix)
  );
}

/**
 * importProject
 *
 * Existing-repo adoption orchestrator. Connects an existing GitHub repository
 * to the vibe-framework by generating framework adoption files and opening a
 * bootstrap PR. The repo's application code is never touched.
 *
 * **Step-by-step flow:**
 * 1. Validate params (Zod). Throw `"Invalid params: ..."` immediately on failure.
 * 2. Resolve `azure_subscription_id`: prefer caller-supplied param, fall back to
 *    `AZURE_SUBSCRIPTION_ID` env var. Throw immediately if neither is set — before
 *    any GitHub resources are created.
 * 3. Validate the target repo exists and is accessible via `repos.get`.
 * 4. Best-effort Codespaces enablement via `PUT /repos/{owner}/{repo}/codespaces/access`.
 *    Wrapped in try/catch — non-fatal if plan or org restrictions apply.
 * 5. **Open a bootstrap PR first** (before any provisioning) so that partial failures
 *    always leave a visible, recoverable GitHub state:
 *    a. Create a `bootstrap/vibe-adopt` branch from the repo's default branch.
 *    b. Generate adoption files via `generateNextjsScaffold()`, filtered to
 *       framework-level files only (vibe.yaml, CLAUDE.md, AGENTS.md, .ai/context/,
 *       .devcontainer/, .github/workflows/, infrastructure/).
 *    c. Commit those files via the Git data API (blobs → tree → commit → ref).
 *    d. Open PR titled `"chore: adopt vibe-framework"` targeting the default branch.
 * 6. Call `configureCloud` to provision a dedicated Azure Container Apps environment.
 * 7. Call `configureRepo` to configure GitHub environments, branch protections, OIDC
 *    secrets, and the `VIBE_BACKEND_URL` repo variable.
 * 8. On success: update the PR body with real Azure outputs (ACR login server, FQDNs).
 * 9. On failure: post an error comment to the PR with retry instructions, then re-throw.
 *
 * **Does NOT:**
 * - Modify the repo's default branch directly — all changes arrive via the bootstrap PR.
 * - Overwrite application code (`src/`, `package.json`, `Dockerfile`, etc.).
 * - Deploy the application — deployment is triggered by GitHub Actions after PR merge.
 * - Validate that `approvers` are valid GitHub users.
 *
 * **Key constraints:**
 * - `azure_subscription_id` must be resolvable before any GitHub resources are created.
 * - PR-first ordering: the bootstrap PR must be open before any Azure provisioning starts.
 * - Only `template: "nextjs"` is supported in this phase.
 *
 * @param params - Must match `ImportProjectParams` schema:
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `azure_subscription_id` (string, optional) — falls back to `AZURE_SUBSCRIPTION_ID` env var
 *   - `approvers` (string[], required, min 1)
 *   - `framework_repo` (string, optional, default `"pmermel/vibe-framework"`)
 *   - `template` (`"nextjs"`, optional, default `"nextjs"`)
 * @returns `{ status, github_repo, bootstrap_pr_url, bootstrap_pr_number, cloud_provisioned, repo_configured }` on success.
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws `"azure_subscription_id is required..."` if subscription cannot be resolved.
 * @throws GitHub API errors if repo access or Git operations fail.
 * @throws Azure or Graph API errors if cloud provisioning fails (after posting PR comment).
 */
export async function importProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ImportProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const config = parsed.data;
  const [owner, repo] = config.github_repo.split("/");

  // Resolve azure_subscription_id: prefer caller-supplied, fall back to the env var
  // set by setup-azure.sh during framework bootstrap. Fail immediately if neither is
  // available — import_project always provisions Azure infra; silent degradation is
  // not acceptable because it returns a "successful" but incomplete adoption.
  const subscriptionId = config.azure_subscription_id ?? process.env.AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error(
      "azure_subscription_id is required but was not provided and AZURE_SUBSCRIPTION_ID " +
      "is not set in the backend environment. Complete framework bootstrap via init.sh " +
      "(which wires AZURE_SUBSCRIPTION_ID to the backend container) or pass " +
      "azure_subscription_id explicitly."
    );
  }

  const octokit = getGithubClient();

  // Validate the repo exists and is accessible via the GitHub App
  const repoResponse = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoResponse.data.default_branch ?? "main";

  // Best-effort Codespaces enablement. Wrapped in try/catch — non-fatal if
  // plan or org restrictions apply. Does not block the rest of the bootstrap.
  try {
    await octokit.request("PUT /repos/{owner}/{repo}/codespaces/access", {
      owner,
      repo,
      visibility: "all",
    });
  } catch (err: unknown) {
    console.warn(
      `[import_project] Warning: failed to enable Codespaces access on ` +
        `${owner}/${repo}. This is non-fatal — adoption continues. Error: ${String(err)}`
    );
  }

  // Get the commit SHA at the tip of the default branch
  const refResponse = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = refResponse.data.object.sha;

  // Fetch the tree SHA for the base commit.
  // git.createTree({ base_tree }) expects a tree SHA, not a commit SHA.
  const baseCommit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  // Generate the full scaffold and filter to framework-level files only.
  // We never overwrite application code (src/, package.json, Dockerfile, etc.).
  const allScaffoldFiles = generateNextjsScaffold({
    name: repo,
    github_owner: owner,
    azure_region: config.azure_region,
    adapter: "container-app",
    approvers: config.approvers,
    framework_repo: config.framework_repo,
  });

  const adoptionFiles = Object.fromEntries(
    Object.entries(allScaffoldFiles).filter(([filePath]) => isFrameworkFile(filePath))
  );

  // Create a blob for each adoption file and build a tree
  const treeItems = await Promise.all(
    Object.entries(adoptionFiles).map(async ([filePath, content]) => {
      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content,
        encoding: "utf-8",
      });
      return {
        path: filePath,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data.sha,
      };
    })
  );

  // Create a new git tree on top of the base tree (tree SHA, not commit SHA)
  const treeResponse = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // Create the adoption commit
  const commitResponse = await octokit.git.createCommit({
    owner,
    repo,
    message: "chore(bootstrap): adopt vibe-framework",
    tree: treeResponse.data.sha,
    parents: [baseSha],
  });

  // Create the bootstrap/vibe-adopt branch pointing at the new commit
  const bootstrapBranch = "bootstrap/vibe-adopt";
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${bootstrapBranch}`,
    sha: commitResponse.data.sha,
  });

  // Open the bootstrap PR immediately — before any provisioning.
  // The PR is the GitHub-centered handoff surface. It must exist as soon as the
  // adoption branch is pushed so that partial failures leave the user with a
  // recoverable, reviewable state in GitHub rather than a silent dead end.
  const prResponse = await octokit.pulls.create({
    owner,
    repo,
    title: "chore: adopt vibe-framework",
    body: bootstrapPrBody(repo, config.azure_region, Object.keys(adoptionFiles), undefined),
    head: bootstrapBranch,
    base: defaultBranch,
  });

  const prNumber = prResponse.data.number;

  // --- Azure provisioning and GitHub repo configuration ---
  // Always performed — subscriptionId was resolved and validated above.
  // Runs after the PR is open so any failure is still visible and recoverable via GitHub.
  let cloudOutputs: Record<string, unknown> | undefined;
  let cloudProvisioned = false;
  let repoConfigured = false;

  try {
    cloudOutputs = (await configureCloud({
      project_name: repo,
      github_repo: config.github_repo,
      azure_subscription_id: subscriptionId,
      azure_region: config.azure_region,
      adapter: "container-app",
    })) as Record<string, unknown>;

    // Only proceed with configureRepo if cloud provisioning succeeded (not "not_implemented")
    if (cloudOutputs.status !== "not_implemented") {
      cloudProvisioned = true;

      const oidcClientIds = cloudOutputs.oidc_client_ids as { preview: string; staging: string; production: string };

      await configureRepo({
        github_repo: config.github_repo,
        approvers: config.approvers,
        azure_client_ids: oidcClientIds,
        azure_tenant_id: cloudOutputs.tenant_id as string,
        azure_subscription_id: cloudOutputs.subscription_id as string,
        // Wire the backend URL into the adopted repo's variable so the
        // post-enrichment workflow job can reach the backend for screenshot posting.
        backend_url: process.env.BACKEND_URL,
      });

      repoConfigured = true;

      // Update PR body with real Azure outputs now that provisioning succeeded.
      await octokit.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        body: bootstrapPrBody(repo, config.azure_region, Object.keys(adoptionFiles), cloudOutputs),
      });
    }
  } catch (err: unknown) {
    // Provisioning failed — post an error comment to the PR so the failure is
    // visible and recoverable in GitHub. Re-throw so the caller knows it failed.
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: [
        "❌ **Azure provisioning failed**",
        "",
        "The adoption branch and bootstrap PR were created successfully, but Azure provisioning failed with:",
        "",
        "```",
        String(err),
        "```",
        "",
        "To retry, call `configure_cloud` and `configure_repo` with this repo as the target, then update the PR description with the outputs.",
      ].join("\n"),
    }).catch(() => {
      // Best-effort — don't mask the original error if the comment itself fails.
    });
    throw err;
  }

  return {
    status: "adopted",
    github_repo: config.github_repo,
    bootstrap_pr_url: prResponse.data.html_url,
    bootstrap_pr_number: prNumber,
    cloud_provisioned: cloudProvisioned,
    repo_configured: repoConfigured,
  };
}

function bootstrapPrBody(
  repoName: string,
  azureRegion: string,
  adoptedFiles: string[],
  cloudOutputs?: Record<string, unknown>
): string {
  const fileList = adoptedFiles.map((f) => `- \`${f}\``).join("\n");

  const azureSection = cloudOutputs
    ? `### Azure provisioning

| Resource | Value |
|---|---|
| ACR login server | \`${cloudOutputs.acr_login_server ?? "—"}\` |
| Staging FQDN | \`${cloudOutputs.staging_fqdn ?? "—"}\` |
| Production FQDN | \`${cloudOutputs.production_fqdn ?? "—"}\` |
| Resource group | \`${cloudOutputs.resource_group ?? `${repoName}-rg`}\` |
| Region | \`${azureRegion}\` |

GitHub environments (\`preview\`, \`staging\`, \`production\`) have been configured with
per-environment \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, and \`AZURE_SUBSCRIPTION_ID\` secrets.`
    : `### Checklist

- [ ] Azure OIDC trust configured for \`${repoName}\` in \`${azureRegion}\` — Azure provisioning in progress…
- [ ] GitHub environments (\`preview\`, \`staging\`, \`production\`) configured with Azure secrets`;

  return `## vibe-framework Adoption

This PR was opened automatically by \`import_project\`.

### What was added

The following framework files have been added. Your existing application code was not modified.

${fileList}

${azureSection}

### Next steps

Review and merge this PR to trigger the first preview deployment. Then open feature branches to continue building.
`;
}
