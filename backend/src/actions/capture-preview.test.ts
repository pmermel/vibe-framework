import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: vi.fn(),
}));

import { capturePreview } from "./capture-preview.js";
import { getGithubClient } from "../lib/github-client.js";

function makeMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    gists: {
      create: vi.fn().mockResolvedValue({
        data: { id: "abc123" },
      }),
    },
    issues: {
      createComment: vi.fn().mockResolvedValue({
        data: { id: 888, html_url: "https://github.com/owner/repo/pull/5#issuecomment-888" },
      }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getGithubClient).mockReturnValue(makeMockOctokit() as never);
});

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
  it("returns posted:true with screenshot_url and comment metadata", async () => {
    const result = (await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 5,
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    expect(result.status).toBe("captured");
    expect(result.screenshot_url).toContain("gist.githubusercontent.com");
    expect(result.screenshot_url).toContain("abc123");
    expect(result.comment_id).toBe(888);
    expect(result.comment_url).toContain("issuecomment-888");
    expect(result.size_bytes).toBeGreaterThan(0);
  });

  it("creates a Gist with a PNG filename containing the pr_number", async () => {
    const mockOctokit = makeMockOctokit();
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 42,
    });

    const gistCall = mockOctokit.gists.create.mock.calls[0][0] as Record<string, unknown>;
    expect(gistCall.public).toBe(true);
    expect(Object.keys(gistCall.files as object)).toContain("preview-pr-42.png");
  });

  it("posts a PR comment containing the Gist image URL", async () => {
    const mockOctokit = makeMockOctokit();
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "myorg/myrepo",
      pr_number: 7,
    });

    const commentCall = mockOctokit.issues.createComment.mock.calls[0][0] as Record<string, unknown>;
    expect(commentCall.owner).toBe("myorg");
    expect(commentCall.repo).toBe("myrepo");
    expect(commentCall.issue_number).toBe(7);
    expect(commentCall.body).toContain("![Preview screenshot]");
    expect(commentCall.body).toContain("gist.githubusercontent.com");
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
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("capturePreview — error paths", () => {
  it("surfaces Gist creation errors to the caller", async () => {
    const mockOctokit = makeMockOctokit({
      gists: {
        create: vi.fn().mockRejectedValue(new Error("Gist API 403")),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await expect(
      capturePreview({
        url: "https://preview.example.com",
        github_repo: "owner/repo",
        pr_number: 1,
      })
    ).rejects.toThrow("Gist API 403");
  });

  it("surfaces PR comment errors to the caller", async () => {
    const mockOctokit = makeMockOctokit({
      issues: {
        createComment: vi.fn().mockRejectedValue(new Error("Comment API 422")),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await expect(
      capturePreview({
        url: "https://preview.example.com",
        github_repo: "owner/repo",
        pr_number: 1,
      })
    ).rejects.toThrow("Comment API 422");
  });
});
