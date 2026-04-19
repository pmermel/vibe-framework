// framework-env.bicep
// Provisions the vibe-framework backend's OWN shared Azure infrastructure.
// This is separate from container-apps-env.bicep (which is for generated projects).
//
// Resources provisioned:
//   - Azure Container Registry (Basic SKU) — stores the backend Docker image
//   - Container Apps managed environment — hosts the backend Container App
//   - Container App for the vibe backend (system-assigned managed identity)
//   - AcrPull role assignment: backend identity → ACR
//
// The Container App is deployed with a placeholder image on first run.
// The real image is built and pushed by setup-azure.sh immediately after this
// Bicep deployment completes, then the Container App is updated to use it.
//
// Scale: min 0, max 1 — cost-safe default; scale up as needed.

@description('Azure region for all resources in this module.')
param location string = resourceGroup().location

@description('Name of the vibe backend Container App.')
param backendAppName string = 'vibe-backend'

@description('Globally unique, alphanumeric-only name for the Azure Container Registry (5–50 chars).')
@minLength(5)
@maxLength(50)
param registryName string

@description('Name of the Container Apps managed environment for the framework backend.')
param environmentName string = 'vibe-framework-env'

// ---------------------------------------------------------------------------
// Azure Container Registry
// ---------------------------------------------------------------------------

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    // Admin credentials disabled — the Container App authenticates via managed identity.
    adminUserEnabled: false
  }
}

// ---------------------------------------------------------------------------
// Container Apps managed environment (one per framework deployment)
// ---------------------------------------------------------------------------

resource managedEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    // Consumption-only workload profile — no dedicated hardware cost when idle.
    zoneRedundant: false
  }
}

// ---------------------------------------------------------------------------
// Backend Container App
// ---------------------------------------------------------------------------

resource backendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: backendAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: managedEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
      // registries block intentionally omitted from initial deployment.
      // The placeholder image is public (MCR) and needs no ACR auth.
      // setup-azure.sh adds the registry config via `az containerapp update`
      // after the AcrPull role assignment has propagated, avoiding the
      // "Operation expired" failure caused by RBAC propagation delay.
    }
    template: {
      containers: [
        {
          name: backendAppName
          // Placeholder image — replaced by setup-azure.sh after acr build + push.
          // This avoids an empty containers array which Bicep rejects.
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        // Cost-safe default: scale to zero when idle, cap at 1 for the framework backend.
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AcrPull role assignment: backend managed identity → ACR
// ---------------------------------------------------------------------------

// Built-in AcrPull role definition ID — stable across all Azure tenants
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource backendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Role assignment scope is the ACR resource itself
  scope: acr
  // Deterministic GUID derived from scope + role + principal — idempotent on re-run
  name: guid(acr.id, backendApp.id, acrPullRoleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleDefinitionId)
    principalId: backendApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Storage Account for screenshots
// ---------------------------------------------------------------------------

// Name is deterministic: uniqueString(rg.id) + 'vibeshots', truncated to 24 chars, all lowercase.
// uniqueString returns 13 hex chars; 'vibeshots' is 9 chars — total 22, within the 24-char limit.
var storageAccountName = '${take(uniqueString(resourceGroup().id), 13)}vibeshots'

resource screenshotsStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    // Allow anonymous read access at the blob level (public screenshots container).
    allowBlobPublicAccess: true
    minimumTlsVersion: 'TLS1_2'
  }
}

resource screenshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  // Path: <storageAccount>/default/<containerName>
  name: '${screenshotsStorage.name}/default/screenshots'
  properties: {
    // Anonymous read for individual blobs — no listing of container contents.
    publicAccess: 'Blob'
  }
}

// ---------------------------------------------------------------------------
// Storage Blob Data Contributor: backend identity → screenshots storage account
// ---------------------------------------------------------------------------

// Built-in Storage Blob Data Contributor role definition ID — stable across all Azure tenants
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource backendStorageBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: screenshotsStorage
  name: guid(screenshotsStorage.id, backendApp.id, storageBlobDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: backendApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('Full HTTPS FQDN of the backend Container App ingress.')
output backendUrl string = 'https://${backendApp.properties.configuration.ingress.fqdn}'

@description('Login server URL for the ACR (e.g. vibeframework123456.azurecr.io).')
output acrLoginServer string = acr.properties.loginServer

@description('Resource ID of the ACR.')
output acrId string = acr.id

@description('Principal ID of the backend Container App system-assigned identity.')
output backendPrincipalId string = backendApp.identity.principalId

@description('Name of the Azure Storage Account used for screenshot blob storage.')
output storageAccountName string = screenshotsStorage.name

@description('Public URL of the screenshots blob container.')
output screenshotsContainerUrl string = 'https://${screenshotsStorage.name}.blob.core.windows.net/screenshots'
