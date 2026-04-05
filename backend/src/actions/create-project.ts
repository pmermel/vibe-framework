import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";
import { generateNextjsScaffold } from "../scaffold/nextjs.js";

const CreateProjectParams = z.object({
  name: z.string(),
  template: z.enum(["nextjs", "react-vite", "node-api"]),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
  github_owner: z.string(),
  azure_region: z.string().default("eastus2"),
  approvers: z.array(z.string()).min(1),
  framework_repo: z.string().default("pmermel/vibe-framework"),
});

/**
 * createProject
 *
 * Fresh-repo bootstrap path. Creates a new GitHub repository under `github_owner`,
 * scaffolds the selected template, and opens a bootstrap PR with all framework files.
 *
 * **Phase 1 support:** Only `"nextjs"` is the validated and implemented template.
 * `"react-vite"` and `"node-api"` are accepted by the schema but are NOT yet
 * implemented — they are deferred to Phase 4. Passing either currently returns
 * `{ status: "not_implemented" }`.
 *
 * Does NOT commit directly to the default branch — all changes arrive via bootstrap PR.
 * Does NOT deploy the application — deployment is triggered by GitHub Actions after the
 * bootstrap PR is merged.
 * Does NOT provision Azure resources — `configure_cloud` handles that and is deferred.
 * Does NOT configure GitHub environments, branch protections, or secrets — `configure_repo`
 * handles that and is deferred.
 * Does NOT validate that `approvers` are valid GitHub users.
 *
 * See `.ai/context/BOOTSTRAP_CONTRACTS.md` for the full step-by-step contract.
 *
 * @param params - Must match `CreateProjectParams` schema:
 *   - `name` (string, required — new repo name)
 *   - `template` (`"nextjs"` — Phase 1 validated; `"react-vite"` | `"node-api"` deferred to Phase 4)
 *   - `adapter` (`"container-app" | "static-web-app"`, optional, default `"container-app"`)
 *   - `github_owner` (string, required — org or user that will own the repo)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `approvers` (string[], required, min 1)
 *   - `framework_repo` (string, optional, default `"pmermel/vibe-framework"`)
 * @returns `{ repo_url, pr_url, pr_number }` on success for nextjs template;
 *          `{ status: "not_implemented" }` for unimplemented templates.
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 * @throws GitHub API errors if repo creation or Git operations fail.
 */
export async function createProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CreateProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const config = parsed.data;

  // Only nextjs is implemented in Phase 1
  if (config.template !== "nextjs") {
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
    createRepoResponse = await octokit.repos.createForAuthenticatedUser({
      name: config.name,
      private: false,
      auto_init: true,
    });
  }

  const repoUrl = createRepoResponse.data.html_url;
  const defaultBranch = createRepoResponse.data.default_branch ?? "main";

  // Get the SHA of the tip of the default branch
  const refResponse = await octokit.git.getRef({
    owner: config.github_owner,
    repo: config.name,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = refResponse.data.object.sha;

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

  // Create a new git tree on top of the base commit
  const treeResponse = await octokit.git.createTree({
    owner: config.github_owner,
    repo: config.name,
    base_tree: baseSha,
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

  // Create the bootstrap branch pointing at the new commit
  const bootstrapBranch = "bootstrap/vibe-setup";
  await octokit.git.createRef({
    owner: config.github_owner,
    repo: config.name,
    ref: `refs/heads/${bootstrapBranch}`,
    sha: commitResponse.data.sha,
  });

  // Open the bootstrap PR
  const prResponse = await octokit.pulls.create({
    owner: config.github_owner,
    repo: config.name,
    title: "chore(bootstrap): vibe-framework scaffold",
    body: bootstrapPrBody(config.name, config.azure_region),
    head: bootstrapBranch,
    base: defaultBranch,
  });

  return {
    repo_url: repoUrl,
    pr_url: prResponse.data.html_url,
    pr_number: prResponse.data.number,
  };
}

function bootstrapPrBody(name: string, azureRegion: string): string {
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

### Checklist

- [ ] Preview URL (populated after CI runs)
- [ ] Azure OIDC trust configured for \`${name}\` in \`${azureRegion}\`
- [ ] GitHub environments (\`preview\`, \`staging\`, \`production\`) configured
- [ ] Codespaces enabled and usable

### Next steps

Merge this PR to trigger the first staging deployment. Then open a feature branch to start building.
`;
}
