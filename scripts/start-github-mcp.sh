#!/bin/bash
# Wrapper for the GitHub MCP server.
# Fetches the current GitHub token from gh CLI (keychain) and passes it
# to the MCP server process. No tokens are stored in config files.
#
# Uses nvm to ensure npx is available since this runs in a minimal shell
# environment that does not load shell profiles automatically.

export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"

export GITHUB_PERSONAL_ACCESS_TOKEN="$(/opt/homebrew/bin/gh auth token)"
exec npx -y @modelcontextprotocol/server-github
