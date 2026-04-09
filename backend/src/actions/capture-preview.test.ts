import { describe, it, expect, vi } from "vitest";

// Mock Playwright before importing the module under test
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png-bytes")),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { capturePreview } from "./capture-preview.js";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

describe("capturePreview — param validation", () => {
  it("throws Invalid params when url is missing", async () => {
    await expect(
      capturePreview({ github_repo: "owner/repo", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when url is not a valid URL", async () => {
    await expect(
      capturePreview({ url: "not-a-url", github_repo: "owner/repo", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      capturePreview({ url: "https://example.com", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "notvalid", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is missing", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is negative", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo", pr_number: -1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is zero", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo", pr_number: 0 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when viewport.width is negative", async () => {
    await expect(
      capturePreview({
        url: "https://example.com",
        github_repo: "owner/repo",
        pr_number: 1,
        viewport: { width: -1, height: 844 },
      })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when viewport.height is negative", async () => {
    await expect(
      capturePreview({
        url: "https://example.com",
        github_repo: "owner/repo",
        pr_number: 1,
        viewport: { width: 390, height: -1 },
      })
    ).rejects.toThrow("Invalid params:");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("capturePreview — happy path", () => {
  it("returns status:captured with size_bytes and posted:false", async () => {
    const result = (await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 5,
    })) as Record<string, unknown>;

    expect(result.status).toBe("captured");
    expect(result.posted).toBe(false);
    expect(result.posted_deferred_reason).toBe("external_storage_required");
    expect(result.size_bytes).toBeGreaterThan(0);
    expect(result.url).toBe("https://preview.example.com");
    expect(result.github_repo).toBe("owner/repo");
    expect(result.pr_number).toBe(5);
  });

  it("does not make any GitHub API calls (no token required for partial impl)", async () => {
    // Verify no github-client import is used — action is self-contained to Playwright
    const result = await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 1,
    });
    // If any GitHub call were made, it would throw on missing env vars.
    // Reaching here without error confirms no GitHub calls.
    expect(result).toBeDefined();
  });

  it("uses default mobile viewport (390x844) when none provided", async () => {
    const { chromium } = await import("playwright");
    const mockPage = {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
    };
    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 1,
    });

    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 });
  });

  it("uses the provided viewport when specified", async () => {
    const { chromium } = await import("playwright");
    const mockPage = {
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
    };
    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 1,
      viewport: { width: 1440, height: 900 },
    });

    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1440, height: 900 });
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("capturePreview — error paths", () => {
  it("surfaces Playwright navigation errors to the caller", async () => {
    const { chromium } = await import("playwright");
    vi.mocked(chromium.launch).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED")),
        screenshot: vi.fn(),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    await expect(
      capturePreview({
        url: "https://preview.example.com",
        github_repo: "owner/repo",
        pr_number: 1,
      })
    ).rejects.toThrow("net::ERR_CONNECTION_REFUSED");
  });
});
