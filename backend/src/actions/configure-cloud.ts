import { z } from "zod";

const ConfigureCloudParams = z.object({
  project_name: z.string(),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  azure_region: z.string().default("eastus2"),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
});

/**
 * configureCloud
 *
 * Provisions Azure infrastructure for a project using the Bicep templates in
 * `infrastructure/`. Creates a dedicated resource group, Container Apps environment,
 * staging and production apps, and OIDC federated credentials so GitHub Actions
 * can deploy without long-lived secrets.
 *
 * Does NOT deploy the application — it only provisions the Azure target environments.
 * Does NOT create or configure the GitHub repository — use `configureRepo` for that.
 * Does NOT write any files to the project repo.
 *
 * @param params - Must match `ConfigureCloudParams` schema:
 *   - `project_name` (string, required)
 *   - `github_repo` (string, required, `owner/repo` format)
 *   - `azure_region` (string, optional, default `"eastus2"`)
 *   - `adapter` (`"container-app" | "static-web-app"`, optional, default `"container-app"`)
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400).
 */
export async function configureCloud(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ConfigureCloudParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const _config = parsed.data;

  // TODO: create resource group via Azure CLI or ARM
  // TODO: deploy container-apps-env.bicep for project-scoped environment
  // TODO: create staging Container App
  // TODO: create production Container App
  // TODO: create OIDC federated credentials on service principal
  // TODO: output resource IDs and URLs for use by configure_repo
  return { status: "not_implemented" };
}
