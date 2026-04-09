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

const SCREENSHOTS_BRANCH = "screenshots";

/**
 * capture_preview
 *
 * Takes a Playwright screenshot of a deployed preview URL and posts it as a
 * comment on the GitHub PR. The screenshot is committed to a dedicated
 * `screenshots` branch in the project repository, then referenced via the
 * raw GitHub URL in a markdown image in the PR comment.
 *
 * Why not GitHub Gist: GitHub App installation tokens cannot create Gists
 * (POST /gists is user-token-only). Committing to the project repo is fully
 * compatible with the framework's installation-token auth model.
 *
 * Branch strategy: Screenshots are committed to `refs/heads/screenshots` in
 * the project repo. This branch is created automatically from the default
 * branch if it does not already exist. Keeping screenshots on a separate
 * branch avoids cluttering the main development history.
 *
 * Default viewport is mobile (390x844 — iPhone 14 Pro) to support the
 * phone-first review workflow.
 *
 * Does NOT upload to Azure Blob Storage.
 * Does NOT deduplicate comments — each call creates a new comment and commit.
 * Requires Playwright chromium: npx playwright install chromium --with-deps
 *
 * @param params - Must match `CapturePreviewParams` schema
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400)
 * @throws GitHub API errors if branch creation, file upload, or comment fails
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
  const filename = `previews/pr-${pr_number}-${Date.now()}.png`;

  // Ensure the screenshots branch exists. If not, create it from the default branch.
  let branchExists = true;
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${SCREENSHOTS_BRANCH}` });
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 404) {
      branchExists = false;
    } else {
      throw err;
    }
  }

  if (!branchExists) {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: defaultRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    });
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${SCREENSHOTS_BRANCH}`,
      sha: defaultRef.object.sha,
    });
  }

  // Commit the screenshot PNG to the screenshots branch.
  // repos.createOrUpdateFileContents is supported by GitHub App installation tokens,
  // unlike the Gists API which requires user OAuth tokens.
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filename,
    message: `chore: preview screenshot for PR #${pr_number}`,
    content: screenshot.toString("base64"),
    branch: SCREENSHOTS_BRANCH,
  });

  // Raw URL is stable once the file is committed to the branch.
  const screenshotUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${SCREENSHOTS_BRANCH}/${filename}`;

  const body = [
    `📸 **Preview screenshot** — ${github_repo}#${pr_number}`,
    `**URL:** ${url}`,
    `**Viewport:** ${viewport.width}×${viewport.height}`,
    ``,
    `![Preview screenshot](${screenshotUrl})`,
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
    screenshot_url: screenshotUrl,
    comment_id: comment.id,
    comment_url: comment.html_url,
  };
}
