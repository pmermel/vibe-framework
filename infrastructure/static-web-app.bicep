// static-web-app.bicep
// Provisions an Azure Static Web App for projects using `adapter: static-web-app`
// in vibe.yaml.
//
// This template is NOT the default deployment path. Use container-apps-env.bicep
// for server workloads (adapter: container-app). This template is for
// static-only projects that set `adapter: static-web-app` explicitly.
//
// Three logical environments are managed by the single SWA resource:
//   - production  — the main site served from the `main` branch
//   - staging     — served from the `develop` branch via a named environment slot
//   - preview     — ephemeral per-PR environments provided by SWA's built-in PR
//                   preview feature; no additional provisioning required
//
// OIDC auth still applies. GitHub Actions authenticate to Azure via OIDC and
// use the SWA deployment token to push static assets.
//
// The deployment token output must be stored as a GitHub Actions secret
// (AZURE_STATIC_WEB_APPS_API_TOKEN) by the caller; it is the only secret
// required for SWA deployments. No long-lived Azure credentials are used.

@description('Short application name — used to derive the SWA resource name.')
param appName string

@description('Azure region for the Static Web App resource.')
param region string = resourceGroup().location

@description('SWA pricing tier. Use Standard for projects that require custom domains or private endpoints. Free is sufficient for internal previews.')
@allowed([
  'Free'
  'Standard'
])
param sku string = 'Standard'

// ---------------------------------------------------------------------------
// Static Web App
// ---------------------------------------------------------------------------

resource swa 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${appName}-swa'
  location: region
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    // Source control integration is handled by GitHub Actions workflows, not
    // by the ARM/Bicep-level source control link. Leave repositoryUrl and
    // branch blank so the SWA is created in "disconnected" mode; the reusable
    // workflows push builds via the deployment token.
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// ---------------------------------------------------------------------------
// Named environment slots — informational note
// ---------------------------------------------------------------------------
//
// SWA Free tier: one production slot only — named environments (staging) and
//   custom domains are Standard-tier features.
// SWA Standard tier: up to 10 named environment slots.
//
// The staging slot mirrors the develop branch; it is deployed by the
// reusable-staging.yml workflow using the same deployment token and the
// --env staging flag in the Azure/static-web-apps-deploy action.
//
// Preview slots are created automatically by SWA when a PR targets the
// production branch and a GitHub Actions workflow posts a build using the
// --env pr-<number> flag; they do not require explicit Bicep resources.
//
// There is no standalone ARM/Bicep resource type for a named SWA environment
// slot — they are created implicitly on first deploy. No Bicep resource is
// declared here for staging or preview slots.

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('Azure resource ID of the Static Web App.')
output swaId string = swa.id

@description('Default hostname of the Static Web App (e.g. gentle-wave-abc123.azurestaticapps.net).')
output defaultHostname string = swa.properties.defaultHostname

@description('Deployment token for GitHub Actions. Store as AZURE_STATIC_WEB_APPS_API_TOKEN in GitHub secrets.')
@secure()
output deploymentToken string = swa.listSecrets().properties.apiKey
