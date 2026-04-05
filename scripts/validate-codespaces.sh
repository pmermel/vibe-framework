#!/usr/bin/env bash
# validate-codespaces.sh
#
# Validates that GitHub Codespaces prerequisites are met for a repository.
# Run this after framework bootstrap or project bootstrap to confirm
# Codespaces is enabled and the devcontainer config is valid.
#
# Usage:
#   bash scripts/validate-codespaces.sh <owner/repo>
#
# Requirements:
#   - gh CLI authenticated with a token that has repo and codespace scopes
#   - jq installed

set -euo pipefail

REPO="${1:-}"

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <owner/repo>" >&2
  exit 1
fi

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == "ok" ]]; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "Validating Codespaces prerequisites for $REPO"
echo "---"

# Check repo exists and is accessible
if gh repo view "$REPO" --json name >/dev/null 2>&1; then
  check "Repository accessible" "ok"
else
  check "Repository accessible" "gh repo view failed — check auth and repo name"
fi

# Check devcontainer.json exists
if gh api "repos/$REPO/contents/.devcontainer/devcontainer.json" --silent >/dev/null 2>&1; then
  check ".devcontainer/devcontainer.json present" "ok"
else
  check ".devcontainer/devcontainer.json present" "file not found in repo"
fi

# Check Codespaces policy via API (requires admin or org:read scope)
# gh api /orgs/{org}/codespaces/billing or /repos/{owner}/{repo} do not expose
# a per-repo Codespaces enabled flag for non-org repos via public API.
# We attempt the org-level billing endpoint and fall back to a manual note.
OWNER="${REPO%%/*}"
CODESPACES_POLICY=$(gh api "orgs/$OWNER/codespaces/billing" --jq '.visibility' 2>/dev/null || echo "")

if [[ -n "$CODESPACES_POLICY" ]]; then
  if [[ "$CODESPACES_POLICY" == "disabled" ]]; then
    check "Codespaces enabled at org level" "DISABLED — enable at https://github.com/organizations/$OWNER/settings/codespaces"
  else
    check "Codespaces enabled at org level ($CODESPACES_POLICY)" "ok"
  fi
else
  # Personal accounts or insufficient scope — cannot verify programmatically
  echo "  [INFO] Codespaces availability cannot be verified via API for personal accounts."
  echo "         Verify manually: https://github.com/$REPO/codespaces/new"
  echo "         If Codespaces is unavailable, ensure your account has Codespaces access."
fi

echo "---"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
