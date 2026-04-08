import { z } from "zod";
import { getGithubClient } from "../lib/github-client.js";

const PostStatusParams = z.object({
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  pr_number: z.number().int().positive(),
  status: z.enum(["pending", "success", "failure"]),
  message: z.string(),
  preview_url: z.string().url().optional(),
});

/**
 * post_status
 *
 * Posts a status comment to a GitHub PR via the GitHub App installation token.
 * Used to report preview deployment status, screenshot availability,
 * and other pipeline events back to the PR.
 *
 * Does NOT merge, promote, or deploy — reports status only.
 * Does NOT deduplicate comments — each call creates a new comment.
 */
export async function postStatus(params: Record<string, unknown>): Promise<unknown> {
  const parsed = PostStatusParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { github_repo, pr_number, status, message, preview_url } = parsed.data;
  const [owner, repo] = github_repo.split("/");

  const emoji = status === "success" ? "✅" : status === "failure" ? "❌" : "⏳";
  const body = [
    `${emoji} **${status.toUpperCase()}** — ${message}`,
    preview_url ? `\n**Preview:** ${preview_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const octokit = getGithubClient();
  const { data: comment } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pr_number,
    body,
  });

  return {
    github_repo,
    pr_number,
    status,
    posted: true,
    comment_id: comment.id,
    comment_url: comment.html_url,
    comment_body: body,
  };
}
