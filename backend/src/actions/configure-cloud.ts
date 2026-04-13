import { z } from "zod";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DefaultAzureCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Compiled ARM JSON lives one level up from the compiled action file.
// At runtime:  dist/actions/configure-cloud.js  → ../infrastructure = dist/infrastructure/
//              dist/infrastructure/ is populated by the `postbuild` npm script, which is
//              run automatically by `npm run build` and by the Docker builder stage.
// In dev mode: src/actions/configure-cloud.ts  → ../infrastructure = src/infrastructure/
//              populated by the `predev` npm script before `tsx watch` starts.
const INFRA_DIR = join(__dirname, "../infrastructure");

const ConfigureCloudParams = z.object({
  project_name: z.string().min(1),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  azure_subscription_id: z.string().min(1),
  azure_region: z.string().default("eastus2"),
  adapter: z.enum(["container-app", "static-web-app"]).default("container-app"),
});

const GITHUB_ENVIRONMENTS = ["preview", "staging", "production"] as const;
const CONTRIBUTOR_ROLE_ID = "b24988ac-6180-42a0-ab88-20f7382dd24c";
const ACR_PUSH_ROLE_ID = "8311e382-0749-4cb8-b61a-304f252e45ec";
const ARM_API = "https://management.azure.com";
const GRAPH_API = "https://graph.microsoft.com";
const ROLE_ASSIGNMENT_API_VERSION = "2022-04-01";

/**
 * deterministicGuid
 *
 * Produces a deterministic UUID-like string from one or more input parts.
 * Used for ARM role assignment names, which must be stable GUIDs so that
 * re-running the action does not create duplicate role assignments.
 */
function deterministicGuid(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("|")).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * getTenantIdFromToken
 *
 * Extracts the tenant ID (tid claim) from a raw Azure AD JWT access token.
 * Used to return the tenant ID from configure_cloud without a separate API call.
 */
function getTenantIdFromToken(token: string): string {
  const payload = token.split(".")[1] ?? "";
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  return (decoded.tid as string) ?? "";
}

/**
 * configureCloud
 *
 * Provisions the Azure infrastructure needed for a generated project to deploy
 * via GitHub Actions OIDC (no stored secrets). Must be called after
 * `create_project` has already run. `configure_repo` should be called after
 * this action to store the returned outputs as GitHub environment secrets.
 *
 * What it does:
 * - Creates a dedicated resource group: `{project_name}-rg`
 * - Deploys `infrastructure/container-apps-env.json` (pre-compiled ARM template) —
 *   Container Apps environment, ACR, staging and production Container Apps
 * - For each GitHub Actions environment (preview, staging, production):
 *   - Creates an Azure AD app registration via Microsoft Graph API (idempotent:
 *     looks up by uniqueName before creating — safe to retry after partial failures)
 *   - Creates a service principal for the app (idempotent: looks up by appId)
 *   - Adds an OIDC federated credential linking the app to the GitHub environment
 *     (idempotent: looks up by name before creating)
 *   - Grants Contributor on the resource group and AcrPush on ACR via ARM REST API
 *     (idempotent: deterministic GUID names, 409 Conflict treated as success)
 * - Returns Azure outputs (clientIds, tenantId, ACR login server, FQDNs) for
 *   the caller to pass to `configure_repo` for GitHub secret storage
 *
 * Why Graph API (not Bicep) for OIDC resources:
 * The `microsoftGraph` Bicep extension used by `infrastructure/oidc-federated-credential.bicep`
 * was retired in Bicep 0.31. Azure AD app registrations, service principals, and
 * federated credentials must now be created via the Microsoft Graph REST API directly.
 * ARM role assignments (Contributor, AcrPush) are still applied via the ARM REST API.
 *
 * What it does NOT do:
 * - Store GitHub environment secrets (caller passes outputs to configure_repo)
 * - Deploy the application (GitHub Actions owns that)
 *
 * Azure auth: DefaultAzureCredential — managed identity when deployed to
 * Container Apps, az login credentials for local development.
 *
 * @param params - Must match `ConfigureCloudParams` schema
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400)
 * @throws Azure or Graph API errors if provisioning fails
 */
export async function configureCloud(params: Record<string, unknown>): Promise<unknown> {
  const parsed = ConfigureCloudParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { project_name, github_repo, azure_subscription_id, azure_region, adapter } = parsed.data;

  const [githubOrg, githubRepoName] = github_repo.split("/");
  const resourceGroupName = `${project_name}-rg`;

  const credential = new DefaultAzureCredential();
  const armClient = new ResourceManagementClient(credential, azure_subscription_id);

  // Acquire tokens for ARM and Graph API up front.
  const [armTokenResponse, graphTokenResponse] = await Promise.all([
    credential.getToken(`${ARM_API}/.default`),
    credential.getToken(`${GRAPH_API}/.default`),
  ]);

  const armToken = armTokenResponse.token;
  const graphToken = graphTokenResponse.token;
  const tenantId = getTenantIdFromToken(graphToken);

  const armHeaders = {
    Authorization: `Bearer ${armToken}`,
    "Content-Type": "application/json",
  };
  const graphHeaders = {
    Authorization: `Bearer ${graphToken}`,
    "Content-Type": "application/json",
  };

  // 1. Create resource group (idempotent)
  await armClient.resourceGroups.createOrUpdate(resourceGroupName, {
    location: azure_region,
    tags: { "vibe-framework": "true", project: project_name },
  });

  const resourceGroupId = `/subscriptions/${azure_subscription_id}/resourceGroups/${resourceGroupName}`;

  if (adapter === "static-web-app") {
    // --- Static Web App path ---
    // Deploy static-web-app.json ARM template (compiled from static-web-app.bicep).
    const swaTemplate = JSON.parse(
      readFileSync(join(INFRA_DIR, "static-web-app.json"), "utf-8")
    ) as Record<string, unknown>;

    const swaDeployment = await armClient.deployments.beginCreateOrUpdateAndWait(
      resourceGroupName,
      `${project_name}-swa-deploy`,
      {
        properties: {
          mode: "Incremental",
          template: swaTemplate,
          parameters: {
            appName: { value: project_name },
            region: { value: azure_region },
          },
        },
      }
    );

    const swaOutputs = (swaDeployment.properties?.outputs ?? {}) as Record<string, { value: string }>;
    const swaHostname: string = swaOutputs.defaultHostname?.value ?? "";
    const swaId: string = swaOutputs.swaId?.value ?? "";
    const deploymentToken: string = swaOutputs.deploymentToken?.value ?? "";

    // For each GitHub Actions environment: create an Azure AD app registration,
    // service principal, and OIDC federated credential via the Microsoft Graph API,
    // then assign Contributor on the resource group via ARM REST API.
    // No ACR/AcrPush role assignment — SWA deployments use the deployment token.
    const clientIds: Record<string, string> = {};

    for (const env of GITHUB_ENVIRONMENTS) {
      const appDisplayName = `${project_name}-github-${env}`;
      const ficName = `${project_name}-${env}-fic`;

      // --- App registration (idempotent: look up by uniqueName before creating) ---
      const existingAppsRes = await fetch(
        `${GRAPH_API}/v1.0/applications?$filter=uniqueName eq '${appDisplayName}'`,
        { headers: graphHeaders }
      );
      if (!existingAppsRes.ok) {
        const err = await existingAppsRes.text();
        throw new Error(`Graph API: failed to look up app registration for ${env}: ${err}`);
      }
      const existingApps = await existingAppsRes.json() as { value: Array<Record<string, string>> };

      let app: Record<string, string>;
      if (existingApps.value.length > 0) {
        app = existingApps.value[0];
      } else {
        const appRes = await fetch(`${GRAPH_API}/v1.0/applications`, {
          method: "POST",
          headers: graphHeaders,
          body: JSON.stringify({ displayName: appDisplayName, uniqueName: appDisplayName }),
        });
        if (!appRes.ok) {
          const err = await appRes.text();
          throw new Error(`Graph API: failed to create app registration for ${env}: ${err}`);
        }
        app = await appRes.json() as Record<string, string>;
      }

      // --- Service principal (idempotent: look up by appId before creating) ---
      const existingSPsRes = await fetch(
        `${GRAPH_API}/v1.0/servicePrincipals?$filter=appId eq '${app.appId}'`,
        { headers: graphHeaders }
      );
      if (!existingSPsRes.ok) {
        const err = await existingSPsRes.text();
        throw new Error(`Graph API: failed to look up service principal for ${env}: ${err}`);
      }
      const existingSPs = await existingSPsRes.json() as { value: Array<Record<string, string>> };

      let sp: Record<string, string>;
      if (existingSPs.value.length > 0) {
        sp = existingSPs.value[0];
      } else {
        const spRes = await fetch(`${GRAPH_API}/v1.0/servicePrincipals`, {
          method: "POST",
          headers: graphHeaders,
          body: JSON.stringify({ appId: app.appId }),
        });
        if (!spRes.ok) {
          const err = await spRes.text();
          throw new Error(`Graph API: failed to create service principal for ${env}: ${err}`);
        }
        sp = await spRes.json() as Record<string, string>;
      }

      // --- Federated credential (idempotent: look up by name before creating) ---
      const existingFicsRes = await fetch(
        `${GRAPH_API}/v1.0/applications/${app.id}/federatedIdentityCredentials?$filter=name eq '${ficName}'`,
        { headers: graphHeaders }
      );
      if (!existingFicsRes.ok) {
        const err = await existingFicsRes.text();
        throw new Error(`Graph API: failed to look up federated credential for ${env}: ${err}`);
      }
      const existingFics = await existingFicsRes.json() as { value: unknown[] };

      if (existingFics.value.length === 0) {
        const ficRes = await fetch(
          `${GRAPH_API}/v1.0/applications/${app.id}/federatedIdentityCredentials`,
          {
            method: "POST",
            headers: graphHeaders,
            body: JSON.stringify({
              name: ficName,
              issuer: "https://token.actions.githubusercontent.com",
              subject: `repo:${githubOrg}/${githubRepoName}:environment:${env}`,
              audiences: ["api://AzureADTokenExchange"],
              description: `GitHub Actions OIDC trust for ${githubOrg}/${githubRepoName} ${env} environment`,
            }),
          }
        );
        if (!ficRes.ok) {
          const err = await ficRes.text();
          throw new Error(`Graph API: failed to create federated credential for ${env}: ${err}`);
        }
      }

      // Assign Contributor role on the resource group (deterministic GUID = idempotent)
      const contributorAssignmentName = deterministicGuid(resourceGroupId, sp.id, CONTRIBUTOR_ROLE_ID);
      const contributorRes = await fetch(
        `${ARM_API}${resourceGroupId}/providers/Microsoft.Authorization/roleAssignments/${contributorAssignmentName}?api-version=${ROLE_ASSIGNMENT_API_VERSION}`,
        {
          method: "PUT",
          headers: armHeaders,
          body: JSON.stringify({
            properties: {
              roleDefinitionId: `/subscriptions/${azure_subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${CONTRIBUTOR_ROLE_ID}`,
              principalId: sp.id,
              principalType: "ServicePrincipal",
            },
          }),
        }
      );
      // 409 Conflict = role assignment already exists — treat as success (idempotent)
      if (!contributorRes.ok && contributorRes.status !== 409) {
        const err = await contributorRes.text();
        throw new Error(`ARM API: failed to assign Contributor for ${env}: ${err}`);
      }

      // No AcrPush assignment — SWA has no container registry.

      clientIds[env] = app.appId;
    }

    return {
      status: "provisioned",
      project_name,
      github_repo,
      resource_group: resourceGroupName,
      azure_region,
      swa_hostname: swaHostname,
      swa_id: swaId,
      deployment_token: deploymentToken,
      oidc_client_ids: clientIds,
      tenant_id: tenantId,
      subscription_id: azure_subscription_id,
    };
  }

  // --- Container App path ---
  const registryName = `${project_name.replace(/-/g, "")}acr`;
  const stagingAppName = `${project_name}-staging`;
  const productionAppName = `${project_name}-prod`;

  // 2. Deploy container-apps-env ARM template (compiled from Bicep at build time).
  //    Using pre-compiled JSON avoids requiring the Bicep CLI at runtime.
  const containerAppsTemplate = JSON.parse(
    readFileSync(join(INFRA_DIR, "container-apps-env.json"), "utf-8")
  ) as Record<string, unknown>;

  const containerAppsDeployment = await armClient.deployments.beginCreateOrUpdateAndWait(
    resourceGroupName,
    `${project_name}-env-deploy`,
    {
      properties: {
        mode: "Incremental",
        template: containerAppsTemplate,
        parameters: {
          appName: { value: project_name },
          region: { value: azure_region },
          registryName: { value: registryName },
          stagingAppName: { value: stagingAppName },
          productionAppName: { value: productionAppName },
        },
      },
    }
  );

  const envOutputs = (containerAppsDeployment.properties?.outputs ?? {}) as Record<string, { value: string }>;
  const acrLoginServer: string = envOutputs.acrLoginServer?.value ?? `${registryName}.azurecr.io`;
  const acrId: string = envOutputs.acrId?.value ??
    `/subscriptions/${azure_subscription_id}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerRegistry/registries/${registryName}`;
  const stagingFqdn: string = envOutputs.stagingFqdn?.value ?? "";
  const productionFqdn: string = envOutputs.productionFqdn?.value ?? "";

  // 3. For each GitHub Actions environment: create an Azure AD app registration,
  //    service principal, and OIDC federated credential via the Microsoft Graph API,
  //    then assign Contributor (resource group) and AcrPush (ACR) via ARM REST API.
  //
  //    Note: `infrastructure/oidc-federated-credential.bicep` used the retired
  //    `microsoftGraph` Bicep extension (retired in Bicep 0.31). Azure AD resources
  //    must now be created via the Microsoft Graph REST API directly, which this does.

  const clientIds: Record<string, string> = {};

  for (const env of GITHUB_ENVIRONMENTS) {
    const appDisplayName = `${project_name}-github-${env}`;
    const ficName = `${project_name}-${env}-fic`;

    // --- App registration (idempotent: look up by uniqueName before creating) ---
    const existingAppsRes = await fetch(
      `${GRAPH_API}/v1.0/applications?$filter=uniqueName eq '${appDisplayName}'`,
      { headers: graphHeaders }
    );
    if (!existingAppsRes.ok) {
      const err = await existingAppsRes.text();
      throw new Error(`Graph API: failed to look up app registration for ${env}: ${err}`);
    }
    const existingApps = await existingAppsRes.json() as { value: Array<Record<string, string>> };

    let app: Record<string, string>;
    if (existingApps.value.length > 0) {
      app = existingApps.value[0];
    } else {
      const appRes = await fetch(`${GRAPH_API}/v1.0/applications`, {
        method: "POST",
        headers: graphHeaders,
        body: JSON.stringify({ displayName: appDisplayName, uniqueName: appDisplayName }),
      });
      if (!appRes.ok) {
        const err = await appRes.text();
        throw new Error(`Graph API: failed to create app registration for ${env}: ${err}`);
      }
      app = await appRes.json() as Record<string, string>;
    }

    // --- Service principal (idempotent: look up by appId before creating) ---
    const existingSPsRes = await fetch(
      `${GRAPH_API}/v1.0/servicePrincipals?$filter=appId eq '${app.appId}'`,
      { headers: graphHeaders }
    );
    if (!existingSPsRes.ok) {
      const err = await existingSPsRes.text();
      throw new Error(`Graph API: failed to look up service principal for ${env}: ${err}`);
    }
    const existingSPs = await existingSPsRes.json() as { value: Array<Record<string, string>> };

    let sp: Record<string, string>;
    if (existingSPs.value.length > 0) {
      sp = existingSPs.value[0];
    } else {
      const spRes = await fetch(`${GRAPH_API}/v1.0/servicePrincipals`, {
        method: "POST",
        headers: graphHeaders,
        body: JSON.stringify({ appId: app.appId }),
      });
      if (!spRes.ok) {
        const err = await spRes.text();
        throw new Error(`Graph API: failed to create service principal for ${env}: ${err}`);
      }
      sp = await spRes.json() as Record<string, string>;
    }

    // --- Federated credential (idempotent: look up by name before creating) ---
    const existingFicsRes = await fetch(
      `${GRAPH_API}/v1.0/applications/${app.id}/federatedIdentityCredentials?$filter=name eq '${ficName}'`,
      { headers: graphHeaders }
    );
    if (!existingFicsRes.ok) {
      const err = await existingFicsRes.text();
      throw new Error(`Graph API: failed to look up federated credential for ${env}: ${err}`);
    }
    const existingFics = await existingFicsRes.json() as { value: unknown[] };

    if (existingFics.value.length === 0) {
      const ficRes = await fetch(
        `${GRAPH_API}/v1.0/applications/${app.id}/federatedIdentityCredentials`,
        {
          method: "POST",
          headers: graphHeaders,
          body: JSON.stringify({
            name: ficName,
            issuer: "https://token.actions.githubusercontent.com",
            subject: `repo:${githubOrg}/${githubRepoName}:environment:${env}`,
            audiences: ["api://AzureADTokenExchange"],
            description: `GitHub Actions OIDC trust for ${githubOrg}/${githubRepoName} ${env} environment`,
          }),
        }
      );
      if (!ficRes.ok) {
        const err = await ficRes.text();
        throw new Error(`Graph API: failed to create federated credential for ${env}: ${err}`);
      }
    }

    // Assign Contributor role on the resource group (deterministic GUID = idempotent)
    const contributorAssignmentName = deterministicGuid(resourceGroupId, sp.id, CONTRIBUTOR_ROLE_ID);
    const contributorRes = await fetch(
      `${ARM_API}${resourceGroupId}/providers/Microsoft.Authorization/roleAssignments/${contributorAssignmentName}?api-version=${ROLE_ASSIGNMENT_API_VERSION}`,
      {
        method: "PUT",
        headers: armHeaders,
        body: JSON.stringify({
          properties: {
            roleDefinitionId: `/subscriptions/${azure_subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${CONTRIBUTOR_ROLE_ID}`,
            principalId: sp.id,
            principalType: "ServicePrincipal",
          },
        }),
      }
    );
    // 409 Conflict = role assignment already exists — treat as success (idempotent)
    if (!contributorRes.ok && contributorRes.status !== 409) {
      const err = await contributorRes.text();
      throw new Error(`ARM API: failed to assign Contributor for ${env}: ${err}`);
    }

    // Assign AcrPush role on the ACR (deterministic GUID = idempotent)
    const acrPushAssignmentName = deterministicGuid(acrId, sp.id, ACR_PUSH_ROLE_ID);
    const acrPushRes = await fetch(
      `${ARM_API}${acrId}/providers/Microsoft.Authorization/roleAssignments/${acrPushAssignmentName}?api-version=${ROLE_ASSIGNMENT_API_VERSION}`,
      {
        method: "PUT",
        headers: armHeaders,
        body: JSON.stringify({
          properties: {
            roleDefinitionId: `/subscriptions/${azure_subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${ACR_PUSH_ROLE_ID}`,
            principalId: sp.id,
            principalType: "ServicePrincipal",
          },
        }),
      }
    );
    if (!acrPushRes.ok && acrPushRes.status !== 409) {
      const err = await acrPushRes.text();
      throw new Error(`ARM API: failed to assign AcrPush for ${env}: ${err}`);
    }

    clientIds[env] = app.appId;
  }

  // Return Azure outputs for the caller to pass to configure_repo.
  // configure_repo owns storing AZURE_CLIENT_ID, AZURE_TENANT_ID, and
  // AZURE_SUBSCRIPTION_ID as GitHub environment secrets per DEPLOYMENT_CONTRACT.md.
  return {
    status: "provisioned",
    project_name,
    github_repo,
    resource_group: resourceGroupName,
    azure_region,
    acr_login_server: acrLoginServer,
    acr_id: acrId,
    staging_fqdn: stagingFqdn,
    production_fqdn: productionFqdn,
    // Pass these to configure_repo to set as GitHub environment secrets:
    oidc_client_ids: clientIds,      // { preview: "...", staging: "...", production: "..." }
    tenant_id: tenantId,
    subscription_id: azure_subscription_id,
  };
}
