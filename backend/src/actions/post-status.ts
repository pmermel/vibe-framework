import { z } from "zod";

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
 * Posts a status comment to a GitHub PR via the GitHub App.
 * Used to report preview deployment status, screenshot availability,
 * and other pipeline events back to the PR.
 *
 * Promotion is GitHub-owned — this action reports status only.
 * It does not merge, promote, or deploy.
 */
export async function postStatus(params: Record<string, unknown>): Promise<unknown> {
  const parsed = PostStatusParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { github_repo, pr_number, status, message, preview_url } = parsed.data;

  const emoji = status === "success" ? "✅" : status === "failure" ? "❌" : "⏳";
  const body = [
    `${emoji} **${status.toUpperCase()}** — ${message}`,
    preview_url ? `\n**Preview:** ${preview_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // TODO: post comment via GitHub App installation token
  console.log(`Posting status to ${github_repo}#${pr_number}:\n${body}`);

  return { github_repo, pr_number, status, posted: false, comment_body: body };
}
