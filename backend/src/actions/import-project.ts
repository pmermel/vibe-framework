import { z } from "zod";

const ImportProjectParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
  azure_region: z.string().default("eastus2"),
  approvers: z.array(z.string()).min(1),
});

/**
 * import_project
 *
 * Existing-repo adoption path. Connects an existing GitHub repo and
 * opens a bootstrap PR with framework files. Does not modify the
 * default branch directly.
 *
 * See BOOTSTRAP_CONTRACTS.md for full contract.
 */
export async function importProject(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ImportProjectParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const _config = parsed.data;

  // TODO: connect existing repo via GitHub App
  // TODO: detect existing stack and set template accordingly
  // TODO: generate framework adoption files (vibe.yaml, CLAUDE.md, AGENTS.md, etc.)
  // TODO: call configure_repo
  // TODO: call configure_cloud
  // TODO: enable Codespaces on repo
  // TODO: open bootstrap PR with only framework files + minimum deployability changes
  return { status: "not_implemented" };
}
