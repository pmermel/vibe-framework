// oidc-federated-credential.bicep
//
// IMPORTANT — MAINTENANCE NOTE:
// This Bicep file originally used the `extension microsoftGraph` Bicep extension
// to create Azure AD app registrations, service principals, and federated
// credentials inline. That extension was retired in Bicep 0.31 and can no longer
// be compiled (error BCP407).
//
// Azure AD resources (app registrations, service principals, federated credentials)
// must now be created via the Microsoft Graph REST API directly. In vibe-framework,
// this is done by the `configure_cloud` backend action using `DefaultAzureCredential`
// to acquire a Graph API token and calling the Microsoft Graph v1.0 endpoints.
//
// This file is retained for documentation: it describes the intended resource
// topology and parameter contract. The RBAC role assignments (Contributor and
// AcrPush) are also handled by `configure_cloud` via the ARM REST API directly.
//
// See: backend/src/actions/configure-cloud.ts
// See: .ai/context/DEPLOYMENT_CONTRACT.md — Bootstrap Action Responsibilities

// ---------------------------------------------------------------------------
// Parameters (preserved for documentation — not compiled)
// ---------------------------------------------------------------------------

// @description('Short application name — used to label the app registration.')
// param appName string

// @description('GitHub organisation or user that owns the repository.')
// param githubOrg string

// @description('GitHub repository name (without the org prefix).')
// param githubRepo string

// @description('GitHub Actions environment name this credential is scoped to.')
// @allowed(['production', 'staging', 'preview'])
// param githubEnvironment string

// @description('Resource ID of the project resource group. The service principal receives Contributor on this scope.')
// param resourceGroupId string

// @description('Resource ID of the project ACR. The service principal receives AcrPush on this scope.')
// param registryId string

// ---------------------------------------------------------------------------
// Intended resource topology (implemented in configure_cloud via Graph + ARM APIs)
// ---------------------------------------------------------------------------

// 1. Azure AD app registration
//    POST https://graph.microsoft.com/v1.0/applications
//    { displayName: '{appName}-github-{githubEnvironment}',
//      uniqueName: '{appName}-github-{githubEnvironment}' }

// 2. Service principal
//    POST https://graph.microsoft.com/v1.0/servicePrincipals
//    { appId: <app.appId> }

// 3. OIDC federated credential
//    POST https://graph.microsoft.com/v1.0/applications/{app.id}/federatedIdentityCredentials
//    { name: '{appName}-{githubEnvironment}-fic',
//      issuer: 'https://token.actions.githubusercontent.com',
//      subject: 'repo:{githubOrg}/{githubRepo}:environment:{githubEnvironment}',
//      audiences: ['api://AzureADTokenExchange'] }

// 4. Contributor role on resource group
//    PUT https://management.azure.com/{resourceGroupId}/providers/
//        Microsoft.Authorization/roleAssignments/{deterministicGuid}
//    { properties: { roleDefinitionId: '.../b24988ac-...', principalId: <sp.id> } }

// 5. AcrPush role on ACR
//    PUT https://management.azure.com/{registryId}/providers/
//        Microsoft.Authorization/roleAssignments/{deterministicGuid}
//    { properties: { roleDefinitionId: '.../8311e382-...', principalId: <sp.id> } }

// ---------------------------------------------------------------------------
// Outputs (returned by configure_cloud — not from a Bicep deployment)
// ---------------------------------------------------------------------------

// clientId  — app.appId  → stored as AZURE_CLIENT_ID on the GitHub environment
// principalId — sp.id    → used for role assignment; returned for verification
// tenantId  — from JWT tid claim → stored as AZURE_TENANT_ID on all environments
