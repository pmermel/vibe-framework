import { z } from "zod";

const ConfigureCloudParams = z.object({
  project_name: z.string(),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  azure_region: z.string().default("eastus2"),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
});

/**
 * configure_cloud
 *
 * Provisions Azure resources for a project:
 * - Dedicated resource group
 * - Dedicated Container Apps environment (isolated from framework backend)
 * - Staging and production Container Apps
 * - OIDC federated credentials for preview, staging, and production environments
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
