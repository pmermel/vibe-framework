import { z } from "zod";
import { chromium } from "playwright";

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
 * Takes a Playwright screenshot of a deployed preview URL at mobile viewport
 * (390×844 — iPhone 14 Pro by default) to support the phone-first review workflow.
 *
 * Current status: PARTIAL — screenshot is captured and returned, but NOT posted
 * to GitHub. Screenshot hosting requires external durable storage (Azure Blob
 * Storage or similar) that is compatible with the GitHub App installation-token
 * auth model and does not grow git history with binary blobs.
 *
 * Why not git-based hosting (commits to a screenshots branch):
 * Every preview run permanently adds binary PNG blobs to the project repository
 * with no automated cleanup. Screenshots are transient PR review artifacts, not
 * source history, so git history is the wrong durability boundary.
 *
 * Why not GitHub Gist: POST /gists is user-token-only and is not callable with
 * a GitHub App installation token, which is the auth model this framework uses.
 *
 * Posting is planned for Phase 3 once Azure Blob Storage is wired into the
 * bootstrap path. When available, the action will upload the screenshot to Blob
 * Storage and post a PR comment with the blob URL.
 *
 * Does NOT make any GitHub API calls in this partial implementation.
 * Does NOT upload to Azure Blob Storage (deferred).
 * Requires Playwright chromium: npx playwright install chromium --with-deps
 *
 * @param params - Must match `CapturePreviewParams` schema
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400)
 * @throws Playwright errors if the browser cannot load the URL
 */
export async function capturePreview(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CapturePreviewParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { url, github_repo, pr_number, viewport } = parsed.data;

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

  return {
    url,
    github_repo,
    pr_number,
    size_bytes: screenshot.length,
    status: "captured",
    // posted remains false until Azure Blob Storage is available as a hosting path.
    // Screenshot hosting via git commits causes unbounded binary blob growth.
    // Screenshot hosting via GitHub Gist requires user tokens (not installation tokens).
    posted: false,
    posted_deferred_reason: "external_storage_required",
  };
}
