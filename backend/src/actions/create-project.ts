import { z } from "zod";

const CreateProjectParams = z.object({
  name: z.string(),
  template: z.enum(["nextjs", "react-vite", "node-api"]),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
  github_owner: z.string(),
  azure_region: z.string().default("eastus2"),
  approvers: z.array(z.string()).min(1),
});

/**
 * createProject
 *
 * Fresh-repo bootstrap path. Creates a new GitHub repository under `github_owner`,
 * scaffolds the selected template, provisions Azure infrastructure, and opens a
 * bootstrap PR with all framework files.
 *
 * **Phase 1 support:** Only `"nextjs"` is the validated and implemented template.
 * `"react-vite"` and `"node-api"` are accepted by the schema but are NOT yet
 * implemented — they are deferred to Phase 4. Passing either currently returns
 * `{ status: "not_implemented" }`.
 *
 * Does NOT commit directly to the default branch — all changes arrive via bootstrap PR.
 * Does NOT deploy the application — deployment is triggered by GitHub Actions after the
 * bootstrap PR is merged.
 * Does NOT validate that `approvers` are valid GitHub users — that is deferred to the
 * `configureRepo` call made internally.
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
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 */
export async function createProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CreateProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const _config = parsed.data;

  // TODO: create GitHub repo via GitHub App
  // TODO: scaffold template files into repo
  // TODO: write vibe.yaml, CLAUDE.md, AGENTS.md, .devcontainer, workflows
  // TODO: call configure_repo
  // TODO: call configure_cloud
  // TODO: enable Codespaces on new repo
  // TODO: open bootstrap PR
  return { status: "not_implemented" };
}
