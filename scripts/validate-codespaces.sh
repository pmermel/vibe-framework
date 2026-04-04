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

# Check Codespaces is enabled (requires admin scope or org visibility)
CODESPACES_POLICY=$(gh api "repos/$REPO" --jq '.has_projects' 2>/dev/null || echo "unknown")
# Note: GitHub API does not expose a direct Codespaces enabled flag on public repos.
# Codespaces availability is controlled at the org/user level, not per-repo via API.
# The presence of devcontainer.json and a valid image is the practical signal.
check "Codespaces enablement (org/user level)" "ok — verify manually at https://github.com/$REPO/codespaces/new"

echo "---"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
