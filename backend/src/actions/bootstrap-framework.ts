import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";

const BootstrapFrameworkParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  backend_url: z.string().url("Must be a valid URL"),
});

const GITHUB_ENVIRONMENTS = ["preview", "staging", "production"] as const;

/**
 * bootstrapFramework
 *
 * Validates that the vibe-framework backend's own GitHub and Azure wiring is
 * intact after a deployment. Runs a set of lightweight checks and returns a
 * structured status report.
 *
 * What it checks:
 * 1. GitHub App auth — calls `apps.getAuthenticated()` to confirm the App token
 *    is valid. Requires GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and
 *    GITHUB_APP_INSTALLATION_ID to be set (or GITHUB_TOKEN in dev).
 * 2. Backend health — fetches `{backend_url}/health` and verifies it returns
 *    HTTP 200 with `{ status: "ok" }`. A self-check: confirms the backend can
 *    reach itself via the public ingress URL.
 * 3. GitHub environments — checks that the `preview`, `staging`, and `production`
 *    environments exist on the given `github_repo` using `repos.getEnvironment()`.
 *    These are required for GitHub Actions OIDC trust and deployment gates.
 *
 * What it does NOT do:
 * - Modify any Azure resources
 * - Create or update GitHub environments
 * - Deploy the backend (first-time deploy is handled exclusively by init.sh)
 * - Store or rotate secrets
 *
 * @param params - `{ github_repo: "owner/repo", backend_url: "https://..." }`
 * @returns `{ status, checks, details }` — status is "ok" if all checks pass,
 *   "degraded" if one or more checks fail (action never throws on check failures).
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400)
 */
export async function bootstrapFramework(
  params: Record<string, unknown>
): Promise<{
  status: "ok" | "degraded";
  checks: {
    github_app: boolean;
    backend_health: boolean;
    environments: boolean;
  };
  details: string[];
}> {
  const parsed = BootstrapFrameworkParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { github_repo, backend_url } = parsed.data;
  const [owner, repo] = github_repo.split("/");

  const checks = {
    github_app: false,
    backend_health: false,
    environments: false,
  };
  const details: string[] = [];

  // ---------------------------------------------------------------------------
  // Check 1: GitHub App authentication
  // ---------------------------------------------------------------------------

  try {
    const octokit = getGithubClient();
    await octokit.apps.getAuthenticated();
    checks.github_app = true;
    details.push("GitHub App: authenticated successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    details.push(`GitHub App: authentication failed — ${message}`);
  }

  // ---------------------------------------------------------------------------
  // Check 2: Backend health endpoint
  // ---------------------------------------------------------------------------

  try {
    const healthUrl = `${backend_url.replace(/\/$/, "")}/health`;
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      details.push(`Backend health: HTTP ${response.status} (expected 200)`);
    } else {
      const body = await response.json() as Record<string, unknown>;
      if (body.status === "ok") {
        checks.backend_health = true;
        details.push(`Backend health: ok (${healthUrl})`);
      } else {
        details.push(
          `Backend health: unexpected response body — ${JSON.stringify(body)}`
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    details.push(`Backend health: fetch failed — ${message}`);
  }

  // ---------------------------------------------------------------------------
  // Check 3: GitHub environments exist on the framework repo
  // ---------------------------------------------------------------------------

  const missingEnvs: string[] = [];
  try {
    const octokit = getGithubClient();
    for (const env of GITHUB_ENVIRONMENTS) {
      try {
        await octokit.repos.getEnvironment({ owner, repo, environment_name: env });
      } catch {
        missingEnvs.push(env);
      }
    }
    if (missingEnvs.length === 0) {
      checks.environments = true;
      details.push(
        `GitHub environments: preview, staging, production — all present on ${github_repo}`
      );
    } else {
      details.push(
        `GitHub environments: missing on ${github_repo} — ${missingEnvs.join(", ")}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    details.push(`GitHub environments: check failed — ${message}`);
  }

  // ---------------------------------------------------------------------------
  // Aggregate status
  // ---------------------------------------------------------------------------

  const allPassed =
    checks.github_app && checks.backend_health && checks.environments;

  return {
    status: allPassed ? "ok" : "degraded",
    checks,
    details,
  };
}
