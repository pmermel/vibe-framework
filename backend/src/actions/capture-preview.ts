import { z } from "zod";
import { chromium } from "playwright";

const CapturePreviewParams = z.object({
  url: z.string().url(),
  github_repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  pr_number: z.number().int().positive(),
  viewport: z
    .object({
      width: z.number().default(390),
      height: z.number().default(844),
    })
    .default({ width: 390, height: 844 }),
});

/**
 * capture_preview
 *
 * Takes a screenshot of a deployed preview URL using Playwright headless
 * browser and posts it as a comment on the GitHub PR.
 *
 * Default viewport is mobile (390x844 — iPhone 14 Pro) to support
 * phone-first review workflow.
 *
 * Requires Playwright chromium installed in the backend container.
 * Run: npx playwright install chromium --with-deps
 */
export async function capturePreview(params: Record<string, unknown>): Promise<unknown> {
  const parsed = CapturePreviewParams.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid params: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { url, github_repo, pr_number, viewport } = parsed.data;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const screenshot = await page.screenshot({ type: "png", fullPage: false });

    // TODO: upload screenshot to Azure Blob Storage or GitHub as artifact
    // TODO: post screenshot as PR comment via GitHub App
    console.log(`Captured screenshot of ${url} for ${github_repo}#${pr_number} (${screenshot.length} bytes)`);

    return {
      url,
      pr: `${github_repo}#${pr_number}`,
      size_bytes: screenshot.length,
      status: "captured",
    };
  } finally {
    await browser.close();
  }
}
