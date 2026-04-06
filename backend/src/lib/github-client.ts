import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

/**
 * getGithubClient
 *
 * Returns an authenticated Octokit instance. Supports two auth modes:
 *
 * **GitHub App (production)**
 * Set all three of:
 *   - `GITHUB_APP_ID`              — numeric App ID from the GitHub App settings page
 *   - `GITHUB_APP_PRIVATE_KEY`     — PEM-encoded private key (newlines as `\n` or literal)
 *   - `GITHUB_APP_INSTALLATION_ID` — installation ID for the target user or org
 *
 * When these three vars are present, the client uses `@octokit/auth-app` to sign a
 * short-lived JWT and exchange it for an installation token on every request. This is
 * the correct production auth path — no long-lived credentials are stored.
 *
 * **PAT / GITHUB_TOKEN (development and CI)**
 * Set `GITHUB_TOKEN` to a personal access token (PAT) with `repo` scope, or to the
 * `GITHUB_TOKEN` secret provided by GitHub Actions. Convenient for local development
 * and for the walking-skeleton phase before a GitHub App is configured.
 *
 * **Token type requirements by operation:**
 * - Org-owned repos (`createInOrg`): a GitHub App installation token works.
 * - User-owned repos (`createForAuthenticatedUser`, `getAuthenticated`):
 *   requires a GitHub App *user* access token (via the user OAuth flow) or a PAT
 *   with `repo` scope. Installation tokens are issued to the app, not to a user,
 *   and will not work for user-owned repo creation.
 *
 * **Failure behaviour:**
 * Throws a clear, actionable error if neither auth path is configured. Does NOT
 * fall back silently to unauthenticated requests.
 */
export function getGithubClient(): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: parseInt(appId, 10),
        // Support both literal newlines and escaped \n (common in env var storage)
        privateKey: privateKey.replace(/\\n/g, "\n"),
        installationId: parseInt(installationId, 10),
      },
    });
  }

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return new Octokit({ auth: token });
  }

  throw new Error(
    "GitHub authentication is not configured. " +
      "For production: set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID. " +
      "For development: set GITHUB_TOKEN (PAT with repo scope or GitHub Actions GITHUB_TOKEN)."
  );
}
