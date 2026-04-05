import { z } from "zod";

const ImportProjectParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
  azure_region: z.string().default("eastus2"),
  approvers: z.array(z.string()).min(1),
});

/**
 * importProject
 *
 * Existing-repo adoption path. Connects an existing GitHub repository to the
 * vibe-framework by detecting the current stack, generating framework files
 * (vibe.yaml, CLAUDE.md, AGENTS.md, workflows, devcontainer), and opening a
 * bootstrap PR.
 *
 * Does NOT modify the repository's default branch directly — all changes arrive
 * via the bootstrap PR, which must be reviewed and merged by a human.
 * Does NOT modify existing application source code except for the minimum changes
 * required to make the app deployable (e.g. adding a Dockerfile if absent).
 * Does NOT merge the bootstrap PR.
 *
 * See `.ai/context/BOOTSTRAP_CONTRACTS.md` for the full step-by-step contract.
 *
 * @param params - Must match `ImportProjectParams` schema:
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `adapter` (`"container-app" | "static-web-app"`, optional, default `"container-app"`)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `approvers` (string[], required, min 1)
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
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
