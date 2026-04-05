import { Octokit } from "@octokit/rest";

/**
 * getGithubClient
 *
 * Returns an authenticated Octokit instance using the GITHUB_TOKEN environment
 * variable. In production the token comes from GitHub App installation token
 * minting (see .ai/context/GITHUB_APP_SETUP.md). For the walking skeleton and
 * local testing a personal access token with `repo` scope is sufficient.
 *
 * Does NOT mint GitHub App installation tokens — that is deferred to the GitHub
 * App setup sub-flow tracked in issue #57.
 *
 * @throws if GITHUB_TOKEN is not set.
 */
export function getGithubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required. " +
      "Set it to a personal access token (repo scope) for local use, " +
      "or a GitHub App installation token in production."
    );
  }
  return new Octokit({ auth: token });
}
