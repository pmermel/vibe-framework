#!/usr/bin/env bash
# setup-github.sh
# Configures GitHub Actions and OIDC trust for the vibe-framework repo.
# Called by init.sh — do not run directly unless you know what you are doing.
#
# Required env vars (set by init.sh or passed directly):
#   GITHUB_ORG_OR_USER   — GitHub org or user that owns the framework repo
#   BACKEND_URL          — Full HTTPS URL of the deployed backend (from setup-azure.sh)
#   BACKEND_PRINCIPAL_ID — Azure managed identity principal ID (from setup-azure.sh)
#   AZURE_SUBSCRIPTION_ID — Azure subscription ID
#   RESOURCE_GROUP       — Azure resource group name
#
# Optional env vars:
#   FRAMEWORK_REPO       — Framework repo name (default: vibe-framework)
set -euo pipefail

: "${GITHUB_ORG_OR_USER:?GITHUB_ORG_OR_USER is required}"
: "${BACKEND_URL:?BACKEND_URL is required}"
: "${BACKEND_PRINCIPAL_ID:?BACKEND_PRINCIPAL_ID is required}"
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
: "${RESOURCE_GROUP:?RESOURCE_GROUP is required}"
FRAMEWORK_REPO="${FRAMEWORK_REPO:-vibe-framework}"

FULL_REPO="$GITHUB_ORG_OR_USER/$FRAMEWORK_REPO"

echo "→ Verifying GitHub authentication"
gh auth status

echo "→ Setting VIBE_BACKEND_URL Actions variable on $FULL_REPO"
gh variable set VIBE_BACKEND_URL \
  --body "$BACKEND_URL" \
  --repo "$FULL_REPO"

echo "→ Creating GitHub environments on $FULL_REPO"
for env in preview staging production; do
  echo "   Creating environment: $env"
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/$FULL_REPO/environments/$env" \
    --silent
done

echo "→ Setting up OIDC federated credential for GitHub Actions"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MANUAL STEP REQUIRED: Create OIDC federated credential"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  The backend Container App uses a system-assigned managed identity."
echo "  To allow GitHub Actions to push images and deploy, you need to add"
echo "  a federated credential to an Azure AD app registration that has"
echo "  been granted access to the backend's resource group."
echo ""
echo "  Run the following Azure CLI commands:"
echo ""
echo "  # Create an app registration for the framework CI/CD identity"
echo "  az ad app create --display-name 'vibe-framework-github-actions'"
echo ""
echo "  # Note the appId from the output, then create a service principal:"
echo "  az ad sp create --id <APP_ID>"
echo ""
echo "  # Add federated credentials for each environment:"
for env in preview staging production; do
  echo "  az ad app federated-credential create \\"
  echo "    --id <APP_OBJECT_ID> \\"
  echo "    --parameters '{"
  echo "      \"name\": \"vibe-framework-$env\","
  echo "      \"issuer\": \"https://token.actions.githubusercontent.com\","
  echo "      \"subject\": \"repo:$FULL_REPO:environment:$env\","
  echo "      \"audiences\": [\"api://AzureADTokenExchange\"]"
  echo "    }'"
  echo ""
done
echo "  # Grant Contributor on the resource group:"
echo "  az role assignment create \\"
echo "    --role Contributor \\"
echo "    --assignee <SP_OBJECT_ID> \\"
echo "    --scope /subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "→ Configuring GitHub App for repo automation"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MANUAL STEP REQUIRED: Create GitHub App"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  GitHub App creation requires a browser and cannot be fully automated."
echo "  Complete the following steps:"
echo ""
echo "  1. Go to: https://github.com/organizations/$GITHUB_ORG_OR_USER/settings/apps/new"
echo "     (or https://github.com/settings/apps/new for personal accounts)"
echo "  2. Set the App name (e.g. 'vibe-framework-bot')"
echo "  3. Uncheck 'Active' on the Webhook (not needed for this use case)"
echo "  4. Grant permissions:"
echo "     - Repository: Contents (Read & Write), Issues (Read & Write),"
echo "       Pull Requests (Read & Write), Actions (Read & Write)"
echo "  5. Install the App on the $FULL_REPO repository"
echo "  6. Generate a private key and download the .pem file"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Prompt for GitHub App credentials
read -rp "Enter GITHUB_APP_ID (from the App settings page): " GITHUB_APP_ID
read -rp "Enter path to GITHUB_APP_PRIVATE_KEY (.pem file): " GITHUB_APP_PRIVATE_KEY_PATH
read -rp "Enter GITHUB_APP_INSTALLATION_ID (from App → Installations): " GITHUB_APP_INSTALLATION_ID

if [[ -z "$GITHUB_APP_ID" || -z "$GITHUB_APP_PRIVATE_KEY_PATH" || -z "$GITHUB_APP_INSTALLATION_ID" ]]; then
  echo ""
  echo "ERROR: All three GitHub App values are required."
  echo "       GitHub App setup is a required bootstrap dependency — init.sh cannot complete without it."
  echo "       Re-run init.sh and provide all three values when prompted, or set them via env vars:"
  echo "         GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_INSTALLATION_ID"
  exit 1
else
  PRIVATE_KEY_CONTENT=$(cat "$GITHUB_APP_PRIVATE_KEY_PATH")

  echo "→ Storing GitHub App credentials as Container Apps secrets"
  # Container Apps secret names are limited to 20 characters — use short names.
  az containerapp secret set \
    --name "${BACKEND_APP_NAME:-vibe-backend}" \
    --resource-group "$RESOURCE_GROUP" \
    --secrets \
      "gh-app-id=$GITHUB_APP_ID" \
      "gh-app-pkey=$PRIVATE_KEY_CONTENT" \
      "gh-app-inst-id=$GITHUB_APP_INSTALLATION_ID" \
    --output none

  # Container Apps secrets are not injected automatically — they must be explicitly wired
  # to environment variables via secretRef so the backend can read them from process.env.
  echo "→ Wiring secrets to container environment variables"
  az containerapp update \
    --name "${BACKEND_APP_NAME:-vibe-backend}" \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars \
      "GITHUB_APP_ID=secretref:gh-app-id" \
      "GITHUB_APP_PRIVATE_KEY=secretref:gh-app-pkey" \
      "GITHUB_APP_INSTALLATION_ID=secretref:gh-app-inst-id" \
    --output none

  echo "→ GitHub App credentials stored and wired to container environment"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  GitHub configuration complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Repo:         $FULL_REPO"
echo "  Backend URL:  $BACKEND_URL"
echo "  Environments: preview, staging, production"
echo ""
echo "  Next steps:"
echo "  1. Complete the OIDC federated credential setup (see instructions above)"
echo "  2. Store AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID as"
echo "     GitHub environment secrets for preview, staging, production"
echo "  3. Verify the backend health: curl $BACKEND_URL/health"
echo ""

# If MCP_API_KEY is available (sourced from .vibe-env by init.sh), display it
# so the operator can configure AI agent clients.
if [[ -n "${MCP_API_KEY:-}" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  MCP API Key — save this now, it will not be shown again"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Key: $MCP_API_KEY"
  echo ""
  echo "  Register the backend as an MCP server in your AI agent client:"
  echo "  - Endpoint:       $BACKEND_URL/mcp"
  echo "  - Auth header:    Authorization: Bearer $MCP_API_KEY"
  echo ""
  echo "  For Claude Code, add to ~/.claude.json under mcpServers:"
  echo "    \"vibe-backend\": {"
  echo "      \"type\": \"http\","
  echo "      \"url\": \"$BACKEND_URL/mcp\","
  echo "      \"headers\": { \"Authorization\": \"Bearer $MCP_API_KEY\" }"
  echo "    }"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi
