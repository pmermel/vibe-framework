#!/usr/bin/env bash
# init.sh
# First-time bootstrap for the vibe-framework backend.
# Orchestrates: preflight → Azure provisioning → GitHub configuration → verification.
#
# Usage:
#   bash scripts/init.sh
#
# All required inputs can be pre-set as environment variables to avoid interactive
# prompts (useful for CI or automated re-runs):
#   AZURE_SUBSCRIPTION_ID, AZURE_REGION, RESOURCE_GROUP, REGISTRY_NAME,
#   GITHUB_ORG_OR_USER, FRAMEWORK_REPO
#
# After this script completes, the backend is live at $BACKEND_URL and reachable
# via MCP at $BACKEND_URL/mcp. Register the MCP endpoint in Claude Code or Codex.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  vibe-framework init.sh — first-time backend bootstrap"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Preflight checks
# ---------------------------------------------------------------------------

echo "→ Running preflight checks"

for cmd in az gh jq node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is not installed or not in PATH."
    echo "       Install it and re-run init.sh."
    exit 1
  fi
done

echo "   az, gh, jq, node — all found"

echo "   Checking Azure authentication..."
if ! az account show --output none 2>/dev/null; then
  echo "ERROR: Not authenticated with Azure CLI."
  echo "       Run 'az login' and re-run init.sh."
  exit 1
fi
echo "   Azure: authenticated"

echo "   Checking GitHub authentication..."
if ! gh auth status &>/dev/null; then
  echo "ERROR: Not authenticated with GitHub CLI."
  echo "       Run 'gh auth login' and re-run init.sh."
  exit 1
fi
echo "   GitHub: authenticated"

echo ""

# ---------------------------------------------------------------------------
# Step 2: Prompt for required inputs (or read from env vars if already set)
# ---------------------------------------------------------------------------

echo "→ Collecting configuration"
echo "   (Press Enter to accept defaults shown in brackets)"
echo ""

if [[ -z "${AZURE_SUBSCRIPTION_ID:-}" ]]; then
  # Show available subscriptions to help the user choose
  echo "   Available subscriptions:"
  az account list --query "[].{Name:name, ID:id, IsDefault:isDefault}" --output table 2>/dev/null || true
  echo ""
  read -rp "   AZURE_SUBSCRIPTION_ID: " AZURE_SUBSCRIPTION_ID
fi
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID cannot be empty}"
echo "   Subscription: $AZURE_SUBSCRIPTION_ID"

if [[ -z "${AZURE_REGION:-}" ]]; then
  read -rp "   AZURE_REGION [eastus2]: " AZURE_REGION
  AZURE_REGION="${AZURE_REGION:-eastus2}"
fi
echo "   Region: $AZURE_REGION"

if [[ -z "${RESOURCE_GROUP:-}" ]]; then
  read -rp "   RESOURCE_GROUP [vibe-framework-rg]: " RESOURCE_GROUP
  RESOURCE_GROUP="${RESOURCE_GROUP:-vibe-framework-rg}"
fi
echo "   Resource group: $RESOURCE_GROUP"

if [[ -z "${REGISTRY_NAME:-}" ]]; then
  # Suggest a name with a timestamp suffix to help with global uniqueness
  DEFAULT_REGISTRY="vibeframework$(date +%s | tail -c 6)"
  read -rp "   REGISTRY_NAME [$DEFAULT_REGISTRY]: " REGISTRY_NAME
  REGISTRY_NAME="${REGISTRY_NAME:-$DEFAULT_REGISTRY}"
fi
echo "   ACR registry: $REGISTRY_NAME"

BACKEND_APP_NAME="${BACKEND_APP_NAME:-vibe-backend}"
echo "   Backend app name: $BACKEND_APP_NAME"

if [[ -z "${GITHUB_ORG_OR_USER:-}" ]]; then
  DEFAULT_ORG=$(gh api /user --jq '.login' 2>/dev/null || echo "")
  read -rp "   GITHUB_ORG_OR_USER [$DEFAULT_ORG]: " GITHUB_ORG_OR_USER
  GITHUB_ORG_OR_USER="${GITHUB_ORG_OR_USER:-$DEFAULT_ORG}"
fi
: "${GITHUB_ORG_OR_USER:?GITHUB_ORG_OR_USER cannot be empty}"
echo "   GitHub org/user: $GITHUB_ORG_OR_USER"

if [[ -z "${FRAMEWORK_REPO:-}" ]]; then
  read -rp "   FRAMEWORK_REPO [vibe-framework]: " FRAMEWORK_REPO
  FRAMEWORK_REPO="${FRAMEWORK_REPO:-vibe-framework}"
fi
echo "   Framework repo: $FRAMEWORK_REPO"

echo ""

# ---------------------------------------------------------------------------
# Step 3: Build backend (verify it compiles before deploying)
# ---------------------------------------------------------------------------

echo "→ Building backend (verifying TypeScript compiles)"
(
  cd "$REPO_ROOT/backend"
  npm ci --prefer-offline --no-audit --no-fund 2>&1 | tail -5
  npm run build 2>&1 | tail -10
)
echo "   Backend build: OK"
echo ""

# ---------------------------------------------------------------------------
# Step 4: Provision Azure infrastructure
# ---------------------------------------------------------------------------

echo "→ Provisioning Azure infrastructure (this takes a few minutes)"
export AZURE_SUBSCRIPTION_ID AZURE_REGION RESOURCE_GROUP REGISTRY_NAME BACKEND_APP_NAME
bash "$SCRIPT_DIR/setup-azure.sh"
echo ""

# ---------------------------------------------------------------------------
# Step 5: Source outputs written by setup-azure.sh
# ---------------------------------------------------------------------------

echo "→ Loading Azure outputs from .vibe-env"
# shellcheck source=/dev/null
. "$REPO_ROOT/.vibe-env"
echo "   BACKEND_URL:      $BACKEND_URL"
echo "   ACR_LOGIN_SERVER: $ACR_LOGIN_SERVER"
echo ""

# ---------------------------------------------------------------------------
# Step 6: Configure GitHub
# ---------------------------------------------------------------------------

echo "→ Configuring GitHub"
export GITHUB_ORG_OR_USER FRAMEWORK_REPO BACKEND_URL BACKEND_PRINCIPAL_ID
export AZURE_SUBSCRIPTION_ID RESOURCE_GROUP BACKEND_APP_NAME
bash "$SCRIPT_DIR/setup-github.sh"
echo ""

# ---------------------------------------------------------------------------
# Step 7: Verify backend is reachable
# ---------------------------------------------------------------------------

echo "→ Verifying backend health (3 attempts, 10s between retries)"
HEALTH_OK=false
for attempt in 1 2 3; do
  echo "   Attempt $attempt/3: $BACKEND_URL/health"
  if curl -sf "$BACKEND_URL/health" --max-time 15 --output /dev/null; then
    HEALTH_OK=true
    break
  fi
  if [[ $attempt -lt 3 ]]; then
    echo "   Not ready yet — waiting 10s before retry"
    sleep 10
  fi
done

if [[ "$HEALTH_OK" != "true" ]]; then
  echo ""
  echo "WARNING: Backend health check failed after 3 attempts."
  echo "         The Container App may still be starting up (cold start can take 60s)."
  echo "         Check manually: curl $BACKEND_URL/health"
  echo ""
else
  echo "   Backend health: OK"
fi

# ---------------------------------------------------------------------------
# Step 8: Print success summary
# ---------------------------------------------------------------------------

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Bootstrap complete!"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "  Backend URL:   $BACKEND_URL"
echo "  MCP endpoint:  $BACKEND_URL/mcp"
echo "  Health check:  $BACKEND_URL/health"
echo ""
echo "  Next steps:"
echo "  1. Register the MCP endpoint in Claude Code:"
echo "     Add to claude_desktop_config.json or .claude.json:"
echo "     {"
echo "       \"mcpServers\": {"
echo "         \"vibe\": {"
echo "           \"url\": \"$BACKEND_URL/mcp\""
echo "         }"
echo "       }"
echo "     }"
echo ""
echo "  2. Register in OpenAI Codex (if using):"
echo "     Set MCP_SERVER_URL=$BACKEND_URL/mcp in your Codex environment"
echo ""
echo "  3. Complete any manual OIDC/GitHub App steps printed by setup-github.sh"
echo ""
echo "  4. Run the bootstrap_framework action to verify wiring:"
echo "     curl -X POST $BACKEND_URL/action \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"action\":\"bootstrap_framework\",\"params\":{\"github_repo\":\"$GITHUB_ORG_OR_USER/$FRAMEWORK_REPO\",\"backend_url\":\"$BACKEND_URL\"}}'"
echo ""
