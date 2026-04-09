import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";
import { generateNextjsScaffold } from "../scaffold/nextjs.js";
import { configureCloud } from "./configure-cloud.js";
import { configureRepo } from "./configure-repo.js";

const CreateProjectParams = z.object({
  name: z.string(),
  template: z.enum(["nextjs", "react-vite", "node-api"]),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
  github_owner: z.string(),
  azure_region: z.string().default("eastus2"),
  azure_subscription_id: z.string().optional(),
  approvers: z.array(z.string()).min(1),
  framework_repo: z.string().default("pmermel/vibe-framework"),
});

/**
 * createProject
 *
 * Full project bootstrap orchestrator. Creates a new GitHub repository under
 * `github_owner`, scaffolds the selected template, opens a bootstrap PR, provisions
 * Azure infrastructure (via `configureCloud`), and configures GitHub environments,
 * branch protections, and OIDC secrets (via `configureRepo`). Also enables Codespaces
 * access on the new repo.
 *
 * **Phase 1 support:**
 * - Template: only `"nextjs"` is implemented. `"react-vite"` and `"node-api"` are
 *   schema-accepted but deferred to Phase 4.
 * - Adapter: only `"container-app"` is implemented. `"static-web-app"` reusable
 *   workflows do not yet exist; passing it returns `{ status: "not_implemented" }`.
 *   Both unsupported combinations return `{ status: "not_implemented" }`.
 *
 * Does NOT commit directly to the default branch — all changes arrive via bootstrap PR.
 * Does NOT deploy the application — deployment is triggered by GitHub Actions after the
 * bootstrap PR is merged.
 * Does NOT validate that `approvers` are valid GitHub users.
 *
 * Azure provisioning (`configureCloud`) is only performed when `azure_subscription_id`
 * is provided. When omitted, Azure provisioning and GitHub secret configuration are
 * skipped and the bootstrap PR body will contain placeholder checklist items instead
 * of real Azure outputs.
 *
 * Codespaces enablement is attempted via the GitHub API after repo creation. If it
 * fails (e.g. the GitHub plan or org settings do not allow it), a warning is logged
 * and the error is swallowed — the rest of the bootstrap continues normally.
 *
 * See `.ai/context/BOOTSTRAP_CONTRACTS.md` for the full step-by-step contract.
 *
 * @param params - Must match `CreateProjectParams` schema:
 *   - `name` (string, required — new repo name)
 *   - `template` (`"nextjs"` — Phase 1 validated; `"react-vite"` | `"node-api"` deferred to Phase 4)
 *   - `adapter` (`"container-app"` — Phase 1 validated; `"static-web-app"` deferred to Phase 3)
 *   - `github_owner` (string, required — org or user that will own the repo)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `azure_subscription_id` (string, optional) — when provided, triggers Azure provisioning
 *     via `configureCloud` and GitHub secret configuration via `configureRepo`
 *   - `approvers` (string[], required, min 1)
 *   - `framework_repo` (string, optional, default `"pmermel/vibe-framework"`)
 * @returns `{ repo_url, pr_url, pr_number, cloud_provisioned?, repo_configured? }` on success
 *          for nextjs + container-app; `{ status: "not_implemented" }` for unimplemented combos.
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws GitHub API errors if repo creation or Git operations fail.
 * @throws Azure or Graph API errors if cloud provisioning fails.
 */
export async function createProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CreateProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const config = parsed.data;

  // Only nextjs + container-app is implemented in Phase 1.
  // react-vite and node-api are deferred to Phase 4.
  // static-web-app is deferred to Phase 3 (reusable SWA workflows don't exist yet).
  if (config.template !== "nextjs" || config.adapter !== "container-app") {
    return { status: "not_implemented" };
  }

  const octokit = getGithubClient();

  // Detect whether github_owner is an org or user
  const ownerInfo = await octokit.users.getByUsername({ username: config.github_owner });
  const isOrg = ownerInfo.data.type === "Organization";

  // Create the repository with auto_init so there is an initial commit on the default branch
  let createRepoResponse;
  if (isOrg) {
    createRepoResponse = await octokit.repos.createInOrg({
      org: config.github_owner,
      name: config.name,
      private: false,
      auto_init: true,
    });
  } else {
    // Installation tokens (GitHub App production auth) are issued to the app, not to a
    // user, so they cannot call createForAuthenticatedUser or getAuthenticated. Fail
    // clearly rather than letting those calls return a confusing 403 or wrong-user result.
    // Mirror the exact three-var condition used by getGithubClient() so partial/misconfigured
    // App env vars (with a valid GITHUB_TOKEN fallback) do not incorrectly block this path.
    if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_INSTALLATION_ID) {
      throw new Error(
        `github_owner "${config.github_owner}" is a User, but the backend is configured ` +
          `with GitHub App installation auth (GITHUB_APP_INSTALLATION_ID is set). ` +
          `Installation tokens are app-scoped and cannot create user-owned repositories. ` +
          `Either use an org as github_owner, or set GITHUB_TOKEN to a GitHub App user ` +
          `access token (obtained via the user OAuth flow) or a PAT with repo scope.`
      );
    }
    // For user-owned repos, createForAuthenticatedUser creates under the token's user.
    // Validate that the token user matches the requested github_owner so we don't
    // silently create the repo in the wrong account.
    const authUser = await octokit.users.getAuthenticated();
    if (authUser.data.login !== config.github_owner) {
      throw new Error(
        `github_owner "${config.github_owner}" does not match the authenticated user ` +
          `"${authUser.data.login}". User-owned repos require a GitHub App user access ` +
          `token (via the user OAuth flow) or a PAT — not an installation token, which ` +
          `is issued to the app and cannot act as a specific user. ` +
          `To create a repo under an org instead, ensure the owner is an Organization ` +
          `(currently detected as User).`
      );
    }
    createRepoResponse = await octokit.repos.createForAuthenticatedUser({
      name: config.name,
      private: false,
      auto_init: true,
    });
  }

  const repoUrl = createRepoResponse.data.html_url;
  const defaultBranch = createRepoResponse.data.default_branch ?? "main";

  // Enable Codespaces access on the new repo.
  // Codespaces requires specific GitHub plan / org settings. Wrap in try/catch and
  // log a warning if it fails — do not throw, as this is a best-effort convenience
  // feature and should not block the rest of the bootstrap.
  try {
    await octokit.request("PUT /repos/{owner}/{repo}/codespaces/access", {
      owner: config.github_owner,
      repo: config.name,
      visibility: "all",
    });
  } catch (err: unknown) {
    console.warn(
      `[create_project] Warning: failed to enable Codespaces access on ` +
        `${config.github_owner}/${config.name}. This is non-fatal — the repo was ` +
        `created successfully. Error: ${String(err)}`
    );
  }

  // Get the commit SHA at the tip of the default branch
  const refResponse = await octokit.git.getRef({
    owner: config.github_owner,
    repo: config.name,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = refResponse.data.object.sha; // commit SHA — used as parent

  // Fetch the tree SHA for the base commit.
  // git.createTree({ base_tree }) expects a tree SHA, not a commit SHA.
  const baseCommit = await octokit.git.getCommit({
    owner: config.github_owner,
    repo: config.name,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  // Generate scaffold files
  const scaffoldFiles = generateNextjsScaffold({
    name: config.name,
    github_owner: config.github_owner,
    azure_region: config.azure_region,
    adapter: config.adapter,
    approvers: config.approvers,
    framework_repo: config.framework_repo,
  });

  // Create a blob for each file and build a tree
  const treeItems = await Promise.all(
    Object.entries(scaffoldFiles).map(async ([filePath, content]) => {
      const blob = await octokit.git.createBlob({
        owner: config.github_owner,
        repo: config.name,
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
    owner: config.github_owner,
    repo: config.name,
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // Create the bootstrap commit
  const commitResponse = await octokit.git.createCommit({
    owner: config.github_owner,
    repo: config.name,
    message: "chore(bootstrap): scaffold vibe-framework Next.js project",
    tree: treeResponse.data.sha,
    parents: [baseSha],
  });

  // Create the develop branch from the scaffold commit (not baseSha / the empty init
  // commit) so that develop already contains the generated project from day one.
  // Feature branches created after the bootstrap PR merges will have the correct base tree.
  // This must happen before the bootstrap PR is opened so that future feature PRs can
  // target develop immediately after the bootstrap PR is merged.
  await octokit.git.createRef({
    owner: config.github_owner,
    repo: config.name,
    ref: "refs/heads/develop",
    sha: commitResponse.data.sha,
  });

  // Create the bootstrap branch pointing at the new commit
  const bootstrapBranch = "bootstrap/vibe-setup";
  await octokit.git.createRef({
    owner: config.github_owner,
    repo: config.name,
    ref: `refs/heads/${bootstrapBranch}`,
    sha: commitResponse.data.sha,
  });

  // --- Azure provisioning and GitHub repo configuration ---
  // Only performed when azure_subscription_id is provided.
  // configureCloud is async and slow (deploys ARM templates). This is acceptable
  // because create_project is already a long-running operation.
  let cloudOutputs: Record<string, unknown> | undefined;
  let cloudProvisioned = false;
  let repoConfigured = false;

  if (config.azure_subscription_id) {
    cloudOutputs = (await configureCloud({
      project_name: config.name,
      github_repo: `${config.github_owner}/${config.name}`,
      azure_subscription_id: config.azure_subscription_id,
      azure_region: config.azure_region,
      adapter: config.adapter,
    })) as Record<string, unknown>;

    // Only proceed with configureRepo if cloud provisioning succeeded (not "not_implemented")
    if (cloudOutputs.status !== "not_implemented") {
      cloudProvisioned = true;

      const oidcClientIds = cloudOutputs.oidc_client_ids as { preview: string; staging: string; production: string };

      await configureRepo({
        github_repo: `${config.github_owner}/${config.name}`,
        approvers: config.approvers,
        azure_client_ids: oidcClientIds,
        azure_tenant_id: cloudOutputs.tenant_id as string,
        azure_subscription_id: cloudOutputs.subscription_id as string,
      });

      repoConfigured = true;
    }
  }

  // Open the bootstrap PR — body includes real Azure outputs when provisioning succeeded
  const prResponse = await octokit.pulls.create({
    owner: config.github_owner,
    repo: config.name,
    title: "chore(bootstrap): vibe-framework scaffold",
    body: bootstrapPrBody(config.name, config.azure_region, cloudProvisioned ? cloudOutputs : undefined),
    head: bootstrapBranch,
    base: defaultBranch,
  });

  return {
    repo_url: repoUrl,
    pr_url: prResponse.data.html_url,
    pr_number: prResponse.data.number,
    cloud_provisioned: cloudProvisioned,
    repo_configured: repoConfigured,
  };
}

function bootstrapPrBody(
  name: string,
  azureRegion: string,
  cloudOutputs?: Record<string, unknown>
): string {
  const azureSection = cloudOutputs
    ? `### Azure provisioning

| Resource | Value |
|---|---|
| ACR login server | \`${cloudOutputs.acr_login_server ?? "—"}\` |
| Staging FQDN | \`${cloudOutputs.staging_fqdn ?? "—"}\` |
| Production FQDN | \`${cloudOutputs.production_fqdn ?? "—"}\` |
| Resource group | \`${cloudOutputs.resource_group ?? `${name}-rg`}\` |
| Region | \`${azureRegion}\` |

GitHub environments (\`preview\`, \`staging\`, \`production\`) have been configured with
per-environment \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, and \`AZURE_SUBSCRIPTION_ID\` secrets.`
    : `### Checklist

- [ ] Azure OIDC trust configured for \`${name}\` in \`${azureRegion}\`
- [ ] GitHub environments (\`preview\`, \`staging\`, \`production\`) configured with Azure secrets`;

  return `## vibe-framework Bootstrap

This PR was opened automatically by \`create_project\`.

### What's included

- \`vibe.yaml\` — project manifest
- \`CLAUDE.md\`, \`AGENTS.md\` — provider instruction files
- \`.devcontainer/devcontainer.json\` — Codespaces support
- \`.github/workflows/\` — thin wrappers calling vibe-framework reusable workflows
- \`Dockerfile\` — multi-stage Next.js production image
- \`package.json\`, \`tsconfig.json\`, \`next.config.ts\` — Next.js config
- \`src/app/\` — minimal app router starter

${azureSection}

### Next steps

Merge this PR to trigger the first staging deployment. Then open a feature branch to start building.
`;
}
