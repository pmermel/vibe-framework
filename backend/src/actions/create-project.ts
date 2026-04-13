import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";
import { generateNextjsScaffold } from "../scaffold/nextjs.js";
import { generateNodeApiScaffold } from "../scaffold/node-api.js";
import { generateReactViteScaffold } from "../scaffold/react-vite.js";
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
 * `github_owner`, scaffolds the selected template, enables Codespaces, opens a
 * bootstrap PR immediately (before any provisioning, so failures leave a visible
 * GitHub-centered handoff surface), then provisions Azure infrastructure via
 * `configureCloud` and configures GitHub environments/branch-protections/OIDC secrets
 * via `configureRepo`. On provisioning success the PR body is updated with real Azure
 * outputs; on failure an error comment is posted to the PR before re-throwing.
 *
 * **Template/adapter support:**
 * - Template: `"nextjs"` and `"node-api"` are implemented on the container-app path.
 *   `"react-vite"` is implemented on the static-web-app path.
 * - Adapter: `"container-app"` (nextjs, node-api) and `"static-web-app"` (react-vite) are
 *   both implemented. Invalid combos (e.g. nextjs+static-web-app) return `not_implemented`.
 *
 * **Subscription ID resolution:**
 * `azure_subscription_id` may be omitted by the caller — the backend falls back to
 * `process.env.AZURE_SUBSCRIPTION_ID`, which `setup-azure.sh` sets on the Container App
 * during framework bootstrap. If neither the param nor the env var is set, the action
 * throws a clear error immediately (before creating any GitHub resources) rather than
 * silently skipping Azure provisioning and returning a partially-configured result.
 *
 * Does NOT commit directly to the default branch — all changes arrive via bootstrap PR.
 * Does NOT deploy the application — deployment is triggered by GitHub Actions after the
 * bootstrap PR is merged.
 * Does NOT validate that `approvers` are valid GitHub users.
 *
 * Codespaces enablement is attempted via the GitHub API after repo creation. If it
 * fails (e.g. plan or org restrictions), a warning is logged and the rest of bootstrap
 * continues normally — this is a best-effort step.
 *
 * See `.ai/context/BOOTSTRAP_CONTRACTS.md` for the full step-by-step contract.
 *
 * @param params - Must match `CreateProjectParams` schema:
 *   - `name` (string, required — new repo name)
 *   - `template` (`"nextjs"` | `"node-api"` on container-app; `"react-vite"` on static-web-app)
 *   - `adapter` (`"container-app"` for nextjs/node-api; `"static-web-app"` for react-vite)
 *   - `github_owner` (string, required — org or user that will own the repo)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `azure_subscription_id` (string, optional) — falls back to `AZURE_SUBSCRIPTION_ID` env var
 *   - `approvers` (string[], required, min 1)
 *   - `framework_repo` (string, optional, default `"pmermel/vibe-framework"`)
 * @returns `{ repo_url, pr_url, pr_number, cloud_provisioned, repo_configured }` on success.
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws `"azure_subscription_id is required..."` if subscription cannot be resolved.
 * @throws GitHub API errors if repo creation or Git operations fail.
 * @throws Azure or Graph API errors if cloud provisioning fails (after posting PR comment).
 */
export async function createProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CreateProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const config = parsed.data;

  // Valid template+adapter combos:
  //   nextjs   + container-app   ✅
  //   node-api + container-app   ✅
  //   react-vite + static-web-app ✅
  // All other combos are not implemented.
  const validCombo =
    (config.adapter === "container-app" && (config.template === "nextjs" || config.template === "node-api")) ||
    (config.adapter === "static-web-app" && config.template === "react-vite");

  if (!validCombo) {
    return { status: "not_implemented" };
  }

  // Resolve azure_subscription_id: prefer caller-supplied, fall back to the env var
  // set by setup-azure.sh during framework bootstrap. Fail immediately if neither is
  // available — create_project always provisions Azure infra; silent degradation is
  // not acceptable because it returns a "successful" but incomplete bootstrap.
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

  // Generate scaffold files based on template
  let scaffoldFiles: Record<string, string>;
  if (config.template === "node-api") {
    scaffoldFiles = generateNodeApiScaffold({
      name: config.name,
      github_owner: config.github_owner,
      azure_region: config.azure_region,
      adapter: config.adapter,
      approvers: config.approvers,
      framework_repo: config.framework_repo,
    });
  } else if (config.template === "react-vite") {
    scaffoldFiles = generateReactViteScaffold({
      name: config.name,
      github_owner: config.github_owner,
      azure_region: config.azure_region,
      adapter: config.adapter,
      approvers: config.approvers,
      framework_repo: config.framework_repo,
    });
  } else {
    scaffoldFiles = generateNextjsScaffold({
      name: config.name,
      github_owner: config.github_owner,
      azure_region: config.azure_region,
      adapter: config.adapter,
      approvers: config.approvers,
      framework_repo: config.framework_repo,
    });
  }

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
    message: `chore(bootstrap): scaffold vibe-framework ${config.template} project`,
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

  // Open the bootstrap PR immediately — before any provisioning.
  // The PR is the GitHub-centered handoff surface. It must exist as soon as the
  // scaffold branch is pushed so that partial failures leave the user with a
  // recoverable, reviewable state in GitHub rather than a silent dead end.
  const prResponse = await octokit.pulls.create({
    owner: config.github_owner,
    repo: config.name,
    title: "chore(bootstrap): vibe-framework scaffold",
    body: bootstrapPrBody(config.name, config.template, config.azure_region, undefined),
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
      project_name: config.name,
      github_repo: `${config.github_owner}/${config.name}`,
      azure_subscription_id: subscriptionId,
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
        // Wire the backend URL into the generated project's repo variable so the
        // post-enrichment workflow job can reach the backend for screenshot posting.
        // process.env.BACKEND_URL is set on the Container App by setup-azure.sh.
        backend_url: process.env.BACKEND_URL,
        // Pass the SWA deployment token as a repo-level secret when on the SWA path.
        // configure_repo stores it as AZURE_STATIC_WEB_APPS_API_TOKEN if present.
        ...(cloudOutputs.deployment_token
          ? { swa_deployment_token: cloudOutputs.deployment_token as string }
          : {}),
      });

      repoConfigured = true;

      // Update PR body with real Azure outputs now that provisioning succeeded.
      await octokit.pulls.update({
        owner: config.github_owner,
        repo: config.name,
        pull_number: prNumber,
        body: bootstrapPrBody(config.name, config.template, config.azure_region, cloudOutputs),
      });
    }
  } catch (err: unknown) {
    // Provisioning failed — post an error comment to the PR so the failure is
    // visible and recoverable in GitHub. Re-throw so the caller knows it failed.
    await octokit.issues.createComment({
      owner: config.github_owner,
      repo: config.name,
      issue_number: prNumber,
      body: [
        "❌ **Azure provisioning failed**",
        "",
        "The repository and bootstrap branch were created successfully, but Azure provisioning failed with:",
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
    repo_url: repoUrl,
    pr_url: prResponse.data.html_url,
    pr_number: prNumber,
    cloud_provisioned: cloudProvisioned,
    repo_configured: repoConfigured,
  };
}

function bootstrapPrBody(
  name: string,
  template: "nextjs" | "react-vite" | "node-api",
  azureRegion: string,
  cloudOutputs?: Record<string, unknown>
): string {
  let templateDescription: string;
  if (template === "node-api") {
    templateDescription = [
      "- `vibe.yaml` — project manifest",
      "- `CLAUDE.md`, `AGENTS.md` — provider instruction files",
      "- `.devcontainer/devcontainer.json` — Codespaces support",
      "- `.github/workflows/` — thin wrappers calling vibe-framework reusable workflows",
      "- `Dockerfile` — multi-stage Node API production image",
      "- `package.json`, `tsconfig.json` — Node API config",
      "- `src/index.ts` — minimal Express starter",
    ].join("\n");
  } else if (template === "react-vite") {
    templateDescription = [
      "- `vibe.yaml` — project manifest",
      "- `CLAUDE.md`, `AGENTS.md` — provider instruction files",
      "- `.devcontainer/devcontainer.json` — Codespaces support (port 5173)",
      "- `.github/workflows/` — inline Azure Static Web Apps deploy workflows",
      "- `index.html`, `vite.config.ts` — Vite project config",
      "- `package.json`, `tsconfig.json` — React/Vite config",
      "- `src/` — minimal React starter (App.tsx, main.tsx)",
    ].join("\n");
  } else {
    templateDescription = [
      "- `vibe.yaml` — project manifest",
      "- `CLAUDE.md`, `AGENTS.md` — provider instruction files",
      "- `.devcontainer/devcontainer.json` — Codespaces support",
      "- `.github/workflows/` — thin wrappers calling vibe-framework reusable workflows",
      "- `Dockerfile` — multi-stage Next.js production image",
      "- `package.json`, `tsconfig.json`, `next.config.ts` — Next.js config",
      "- `src/app/` — minimal app router starter",
    ].join("\n");
  }

  let azureSection: string;
  if (cloudOutputs) {
    if (cloudOutputs.swa_hostname) {
      // Static Web App path
      azureSection = `### Azure provisioning

| Resource | Value |
|---|---|
| Static Web App hostname | \`${cloudOutputs.swa_hostname}\` |
| Resource group | \`${cloudOutputs.resource_group ?? `${name}-rg`}\` |
| Region | \`${azureRegion}\` |

GitHub environments (\`preview\`, \`staging\`, \`production\`) have been configured with
per-environment \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, and \`AZURE_SUBSCRIPTION_ID\` secrets.
\`AZURE_STATIC_WEB_APPS_API_TOKEN\` has been stored as a repo-level secret.`;
    } else {
      // Container App path
      azureSection = `### Azure provisioning

| Resource | Value |
|---|---|
| ACR login server | \`${cloudOutputs.acr_login_server ?? "—"}\` |
| Staging FQDN | \`${cloudOutputs.staging_fqdn ?? "—"}\` |
| Production FQDN | \`${cloudOutputs.production_fqdn ?? "—"}\` |
| Resource group | \`${cloudOutputs.resource_group ?? `${name}-rg`}\` |
| Region | \`${azureRegion}\` |

GitHub environments (\`preview\`, \`staging\`, \`production\`) have been configured with
per-environment \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, and \`AZURE_SUBSCRIPTION_ID\` secrets.`;
    }
  } else {
    azureSection = `### Checklist

- [ ] Azure OIDC trust configured for \`${name}\` in \`${azureRegion}\`
- [ ] GitHub environments (\`preview\`, \`staging\`, \`production\`) configured with Azure secrets`;
  }

  return `## vibe-framework Bootstrap

This PR was opened automatically by \`create_project\`.

### What's included

${templateDescription}

${azureSection}

### Next steps

Merge this PR to trigger the first staging deployment. Then open a feature branch to start building.
`;
}
