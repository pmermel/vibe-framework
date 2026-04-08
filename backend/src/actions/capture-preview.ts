import { z } from "zod";
import { chromium } from "playwright";
import { getGithubClient } from "../lib/github-client.js";

const CapturePreviewParams = z.object({
  url: z.string().url(),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  pr_number: z.number().int().positive(),
  viewport: z
    .object({
      width: z.number().positive().default(390),
      height: z.number().positive().default(844),
    })
    .default({ width: 390, height: 844 }),
});

/**
 * capture_preview
 *
 * Takes a Playwright screenshot of a deployed preview URL and posts it as a
 * comment on the GitHub PR. The screenshot is uploaded as a public GitHub Gist
 * (base64-encoded PNG) and linked via markdown image syntax in the PR comment.
 *
 * Default viewport is mobile (390x844 — iPhone 14 Pro) to support the
 * phone-first review workflow.
 *
 * Does NOT upload to Azure Blob Storage — uses GitHub Gist for hosting.
 * Does NOT deduplicate comments — each call creates a new comment and Gist.
 * Requires Playwright chromium: npx playwright install chromium --with-deps
 */
export async function capturePreview(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CapturePreviewParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { url, github_repo, pr_number, viewport } = parsed.data;
  const [owner, repo] = github_repo.split("/");

  // Take screenshot
  const browser = await chromium.launch();
  let screenshot: Buffer;
  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    screenshot = await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await browser.close();
  }

  const octokit = getGithubClient();
  const filename = `preview-pr-${pr_number}.png`;

  // Upload screenshot to a public Gist as base64-encoded content.
  // GitHub renders raw Gist URLs as images in markdown.
  const { data: gist } = await octokit.gists.create({
    description: `Preview screenshot — ${github_repo}#${pr_number}`,
    public: true,
    files: {
      [filename]: {
        content: screenshot.toString("base64"),
      },
    },
  });

  // Construct raw URL for the Gist file so GitHub renders it as an image
  const gistRawUrl = `https://gist.githubusercontent.com/${owner}/${gist.id}/raw/${filename}`;

  const body = [
    `📸 **Preview screenshot** — ${github_repo}#${pr_number}`,
    `**URL:** ${url}`,
    `**Viewport:** ${viewport.width}×${viewport.height}`,
    ``,
    `![Preview screenshot](${gistRawUrl})`,
  ].join("\n");

  const { data: comment } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: pr_number,
    body,
  });

  return {
    url,
    github_repo,
    pr_number,
    size_bytes: screenshot.length,
    status: "captured",
    posted: true,
    screenshot_url: gistRawUrl,
    comment_id: comment.id,
    comment_url: comment.html_url,
  };
}
