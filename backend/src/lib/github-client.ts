import { Octokit } from "@octokit/rest";

/**
 * getGithubClient
 *
 * Returns an authenticated Octokit instance using the GITHUB_TOKEN environment
 * variable.
 *
 * **Token type requirements by operation:**
 * - Org-owned repos (`createInOrg`): a GitHub App installation token works.
 * - User-owned repos (`createForAuthenticatedUser`, `getAuthenticated`):
 *   requires a GitHub App *user* access token (obtained via the user OAuth flow)
 *   or a personal access token (PAT) with `repo` scope. Installation tokens are
 *   issued to the app, not to a user, so they will not work for user-owned repo
 *   creation.
 *
 * For the walking skeleton and local development, a PAT with `repo` scope is
 * the simplest choice. Full GitHub App user auth is deferred to issue #57.
 *
 * Does NOT mint tokens — callers are responsible for providing the correct token
 * type for the operations they intend to perform.
 *
 * @throws if GITHUB_TOKEN is not set.
 */
export function getGithubClient(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required. " +
      "For org-owned repos use a GitHub App installation token. " +
      "For user-owned repos use a GitHub App user access token or a PAT with repo scope."
    );
  }
  return new Octokit({ auth: token });
}
