#!/bin/bash
# Wrapper for the GitHub MCP server.
# Fetches the current GitHub token from gh CLI (keychain) and passes it
# to the MCP server process. No tokens are stored in config files.
export GITHUB_PERSONAL_ACCESS_TOKEN="$(/opt/homebrew/bin/gh auth token)"
exec npx -y @github/mcp-server
