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
 * If `AZURE_STORAGE_ACCOUNT_NAME` is set in the environment, uploads the screenshot
 * to the `screenshots` container in that storage account using DefaultAzureCredential
 * (managed identity in production) and returns the public blob URL. The backend
 * Container App's system-assigned identity must have the Storage Blob Data Contributor
 * role on the storage account (provisioned by framework-env.bicep).
 *
 * If `AZURE_STORAGE_ACCOUNT_NAME` is not set, returns `posted: false` with
 * `posted_deferred_reason: "external_storage_required"` and does not make any
 * Azure Storage calls.
 *
 * Does NOT make any GitHub API calls — callers should use post_status to post
 * the returned `screenshot_url` to a PR comment.
 * Does NOT deploy or promote anything.
 * Requires Playwright chromium: npx playwright install chromium --with-deps
 *
 * @param params - Must match `CapturePreviewParams` schema
 * @throws `"Invalid params: ..."` if schema validation fails (caught by handler → 400)
 * @throws Playwright errors if the browser cannot load the URL
 * @throws Azure Storage errors if upload fails (when storage account is configured)
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

  const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  if (storageAccountName) {
    // Upload to Azure Blob Storage using managed identity (DefaultAzureCredential).
    // Requires the backend identity to have Storage Blob Data Contributor on the account.
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const { DefaultAzureCredential } = await import("@azure/identity");

    const credential = new DefaultAzureCredential();
    const blobServiceClient = new BlobServiceClient(
      `https://${storageAccountName}.blob.core.windows.net`,
      credential
    );

    const containerClient = blobServiceClient.getContainerClient("screenshots");
    const blobName = `pr-${pr_number}/${Date.now()}.png`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(screenshot, {
      blobHTTPHeaders: { blobContentType: "image/png" },
    });

    const screenshotUrl = `https://${storageAccountName}.blob.core.windows.net/screenshots/${blobName}`;

    return {
      url,
      github_repo,
      pr_number,
      size_bytes: screenshot.length,
      status: "captured",
      posted: true,
      screenshot_url: screenshotUrl,
    };
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
