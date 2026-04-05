#!/bin/bash
# Wrapper for the GitHub MCP server (binary install via Homebrew).
# Fetches the current GitHub token from gh CLI (keychain) so no token
# is ever stored in a config file or committed to the repo.
#
# Install: brew install github-mcp-server
export GITHUB_PERSONAL_ACCESS_TOKEN="$(/opt/homebrew/bin/gh auth token)"
exec /opt/homebrew/bin/github-mcp-server stdio
