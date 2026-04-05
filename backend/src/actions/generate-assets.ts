import { z } from "zod";

const GenerateAssetsParams = z.object({
  project_name: z.string(),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  asset_types: z
    .array(z.enum(["icon", "favicon", "og-image", "placeholder-marketing", "screenshot"]))
    .default(["favicon", "og-image"]),
});

/**
 * generateAssets
 *
 * Generates visual and binary assets for a project: favicons, Open Graph images,
 * app icon sets, placeholder marketing graphics, and screenshot artifacts.
 * Generated assets are uploaded to Azure Blob Storage or attached to the PR.
 *
 * Does NOT generate application source code or logic.
 * Does NOT modify files in the GitHub repository directly — assets are attached
 * as PR artifacts or uploaded to blob storage.
 *
 * @param params - Must match `GenerateAssetsParams` schema:
 *   - `project_name` (string, required)
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `asset_types` (Array of `"icon" | "favicon" | "og-image" | "placeholder-marketing" | "screenshot"`,
 *                   optional, default `["favicon", "og-image"]`)
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 */
export async function generateAssets(params: Record<string, unknown>): Promise<unknown> {
  const parsed = GenerateAssetsParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const _config = parsed.data;

  // TODO: generate favicon (32x32, 64x64, 192x192 PNG)
  // TODO: generate Open Graph image (1200x630 PNG)
  // TODO: generate app icon sets
  // TODO: upload artifacts to Azure Blob or attach to PR
  return { status: "not_implemented" };
}
