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
 * create_project
 *
 * Fresh-repo bootstrap path. Creates a new GitHub repo, scaffolds the
 * selected template, provisions Azure resources, and opens a bootstrap PR.
 *
 * See BOOTSTRAP_CONTRACTS.md for full contract.
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
