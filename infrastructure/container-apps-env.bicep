// container-apps-env.bicep
// Provisions per-project Azure resources:
//   - Azure Container Apps managed environment (passed in as a parameter)
//   - Azure Container Registry (ACR)
//   - Staging and production Container Apps with system-assigned managed identity
//   - AcrPull role assignment for staging and production managed identities
//   - A placeholder comment showing how preview apps are named
//
// Preview apps are NOT provisioned here. They are created dynamically by the
// reusable-preview.yml workflow and torn down when the PR closes or the TTL expires.
//
// All Container Apps use min-replicas 0 (scale to zero) for cost efficiency.
// External ingress is enabled on target port 3000.

@description('Short application name — used as prefix for resource names. Must be alphanumeric and hyphens only.')
param appName string

@description('Resource ID of the existing Container Apps managed environment to deploy apps into.')
param environment string

@description('Azure region for all resources in this module.')
param region string = resourceGroup().location

@description('Globally unique, alphanumeric-only name for the Azure Container Registry (5–50 chars).')
@minLength(5)
@maxLength(50)
param registryName string

@description('Full name of the staging Container App resource.')
param stagingAppName string

@description('Full name of the production Container App resource.')
param productionAppName string

// ---------------------------------------------------------------------------
// Azure Container Registry
// ---------------------------------------------------------------------------

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: region
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ---------------------------------------------------------------------------
// Staging Container App
// ---------------------------------------------------------------------------

resource stagingApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: stagingAppName
  location: region
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: environment
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: stagingAppName
          // Image is replaced by the reusable-staging workflow on first deploy.
          // This placeholder avoids an empty containers array which Bicep rejects.
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Production Container App
// ---------------------------------------------------------------------------

resource productionApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: productionAppName
  location: region
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: environment
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: productionAppName
          // Image is replaced by the reusable-production workflow on first deploy.
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Preview Container App — PLACEHOLDER (informational only)
// ---------------------------------------------------------------------------
//
// Preview apps are NOT provisioned by Bicep. They are created dynamically by
// the reusable-preview.yml workflow when a PR is opened, updated, or
// re-triggered, and are torn down when the PR closes or the TTL expires.
//
// Naming convention: ${appName}-pr-<pr-number>
// Example:           my-app-pr-42
//
// See: .github/workflows/reusable-preview.yml
//      .ai/context/AZURE_TARGETS.md

// ---------------------------------------------------------------------------
// AcrPull role assignments for managed identities
// ---------------------------------------------------------------------------

// Built-in AcrPull role definition ID — stable across all Azure tenants
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource stagingAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Role assignment scope is the ACR resource itself
  scope: acr
  // Name must be a deterministic GUID derived from scope + role + principal to be idempotent
  name: guid(acr.id, stagingApp.id, acrPullRoleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleDefinitionId)
    principalId: stagingApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource productionAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, productionApp.id, acrPullRoleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleDefinitionId)
    principalId: productionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('Login server URL for the ACR (e.g. myappacr.azurecr.io).')
output acrLoginServer string = acr.properties.loginServer

@description('Resource ID of the ACR.')
output acrId string = acr.id

@description('FQDN of the staging Container App ingress.')
output stagingFqdn string = stagingApp.properties.configuration.ingress.fqdn

@description('FQDN of the production Container App ingress.')
output productionFqdn string = productionApp.properties.configuration.ingress.fqdn

@description('Principal ID of the staging Container App system-assigned identity.')
output stagingPrincipalId string = stagingApp.identity.principalId

@description('Principal ID of the production Container App system-assigned identity.')
output productionPrincipalId string = productionApp.identity.principalId
