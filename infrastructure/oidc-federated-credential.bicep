// oidc-federated-credential.bicep
// Provisions GitHub Actions OIDC trust for a single GitHub environment on a
// project repository. This template must be called once per environment
// (preview, staging, production), producing three separate Azure AD app
// registrations and service principals, each with:
//
//   - An Azure AD application (app registration)
//   - A service principal for that application
//   - A federated credential linking the app to the specific GitHub repo +
//     environment so GitHub Actions tokens are accepted without a stored secret
//   - Contributor role on the project resource group (deploy access)
//   - AcrPush role on the project ACR (image push access)
//
// OIDC only — this template does not create or output any client secrets.
//
// After deployment the caller stores the output clientId as the GitHub secret
// AZURE_CLIENT_ID on the matching GitHub environment (preview / staging / production).
// Each environment has its own app registration, so the same secret name
// AZURE_CLIENT_ID is used on all three environments — GitHub scopes secrets to the
// environment, which is how the reusable workflows and deployment contract expect it.
//
// Required Azure RBAC to deploy: Owner (or User Access Administrator + Contributor)
// on the target resource group, and Application Administrator in Azure AD.

@description('Short application name — used to label the app registration.')
param appName string

@description('GitHub organisation or user that owns the repository.')
param githubOrg string

@description('GitHub repository name (without the org prefix).')
param githubRepo string

@description('GitHub Actions environment name this credential is scoped to.')
@allowed([
  'production'
  'staging'
  'preview'
])
param githubEnvironment string

@description('Resource ID of the project resource group. The service principal receives Contributor on this scope.')
param resourceGroupId string

@description('Resource ID of the project ACR. The service principal receives AcrPush on this scope.')
param registryId string

// ---------------------------------------------------------------------------
// Azure AD app registration
// ---------------------------------------------------------------------------
// Microsoft.Graph resources require the Microsoft Graph Bicep extension.
// The extension is declared via the `extension microsoftGraph` statement below.
// Bicep CLI 0.26+ supports this; older versions need --features microsoftGraphPreview.

extension microsoftGraph

resource adApp 'Microsoft.Graph/applications@v1.0' = {
  // Display name surfaces in the Azure portal Entra ID blade
  displayName: '${appName}-github-${githubEnvironment}'
  uniqueName: '${appName}-github-${githubEnvironment}'
}

// ---------------------------------------------------------------------------
// Service principal
// ---------------------------------------------------------------------------

resource servicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: adApp.appId
}

// ---------------------------------------------------------------------------
// Federated credential
// ---------------------------------------------------------------------------

resource federatedCredential 'Microsoft.Graph/applications/federatedIdentityCredentials@v1.0' = {
  parent: adApp
  name: '${appName}-${githubEnvironment}-fic'
  subject: 'repo:${githubOrg}/${githubRepo}:environment:${githubEnvironment}'
  issuer: 'https://token.actions.githubusercontent.com'
  audiences: [
    'api://AzureADTokenExchange'
  ]
  description: 'GitHub Actions OIDC trust for ${githubOrg}/${githubRepo} ${githubEnvironment} environment'
}

// ---------------------------------------------------------------------------
// Contributor role on the project resource group
// ---------------------------------------------------------------------------

var contributorRoleDefinitionId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'

resource contributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Scope is expressed as the resource group resource ID.
  // In Bicep, existing resources at subscription scope need a resourceGroup() reference;
  // since this template is deployed at the resource group level, we use resourceGroup().id.
  scope: resourceGroup()
  name: guid(resourceGroupId, servicePrincipal.id, contributorRoleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleDefinitionId)
    principalId: servicePrincipal.id
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// AcrPush role on the project Container Registry
// ---------------------------------------------------------------------------

var acrPushRoleDefinitionId = '8311e382-0749-4cb8-b61a-304f252e45ec'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  // Extract the ACR resource name from the fully-qualified resource ID.
  // registryId format: /subscriptions/.../resourceGroups/.../providers/Microsoft.ContainerRegistry/registries/<name>
  name: last(split(registryId, '/'))
}

resource acrPushAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(registryId, servicePrincipal.id, acrPushRoleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPushRoleDefinitionId)
    principalId: servicePrincipal.id
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('Azure AD application (client) ID. Store as AZURE_CLIENT_ID in the matching GitHub environment secret (preview / staging / production).')
output clientId string = adApp.appId

@description('Service principal object ID.')
output principalId string = servicePrincipal.id

@description('Azure AD tenant ID. Store as AZURE_TENANT_ID in GitHub secrets (shared across environments).')
output tenantId string = tenant().tenantId
