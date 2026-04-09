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
    git: {
      // Screenshots branch exists by default — getRef resolves.
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "branch-sha" } } }),
      createRef: vi.fn().mockResolvedValue({}),
    },
    repos: {
      get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
      createOrUpdateFileContents: vi.fn().mockResolvedValue({ data: {} }),
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
  it("returns posted:true with screenshot_url pointing to raw.githubusercontent.com", async () => {
    const result = (await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 5,
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    expect(result.status).toBe("captured");
    expect(result.screenshot_url).toContain("raw.githubusercontent.com");
    expect(result.screenshot_url).toContain("owner/repo");
    expect(result.screenshot_url).toContain("screenshots");
    expect(result.comment_id).toBe(888);
    expect(result.comment_url).toContain("issuecomment-888");
    expect(result.size_bytes).toBeGreaterThan(0);
  });

  it("commits a PNG file whose path contains the pr_number", async () => {
    const mockOctokit = makeMockOctokit();
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 42,
    });

    const uploadCall = mockOctokit.repos.createOrUpdateFileContents.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof uploadCall.path).toBe("string");
    expect(uploadCall.path as string).toContain("pr-42");
    expect(uploadCall.branch).toBe("screenshots");
  });

  it("posts a PR comment containing the repo-hosted image URL", async () => {
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
    expect(commentCall.body).toContain("raw.githubusercontent.com");
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

  it("creates the screenshots branch when it does not yet exist", async () => {
    const notFoundError = Object.assign(new Error("Not Found"), { status: 404 });
    // getRef is called twice: first for the screenshots branch (404), then
    // for the default branch to get the SHA to branch from (resolves).
    const mockGetRef = vi.fn()
      .mockRejectedValueOnce(notFoundError)
      .mockResolvedValueOnce({ data: { object: { sha: "default-sha" } } });

    const mockOctokit = makeMockOctokit({
      git: {
        getRef: mockGetRef,
        createRef: vi.fn().mockResolvedValue({}),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 1,
    });

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "refs/heads/screenshots" })
    );
  });

  it("skips branch creation when screenshots branch already exists", async () => {
    const mockOctokit = makeMockOctokit();
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await capturePreview({
      url: "https://preview.example.com",
      github_repo: "owner/repo",
      pr_number: 1,
    });

    expect(mockOctokit.git.createRef).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("capturePreview — error paths", () => {
  it("surfaces screenshot upload errors to the caller", async () => {
    const mockOctokit = makeMockOctokit({
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
        createOrUpdateFileContents: vi.fn().mockRejectedValue(new Error("Upload API 403")),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await expect(
      capturePreview({
        url: "https://preview.example.com",
        github_repo: "owner/repo",
        pr_number: 1,
      })
    ).rejects.toThrow("Upload API 403");
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

  it("re-throws non-404 getRef errors without creating the branch", async () => {
    const serverError = Object.assign(new Error("GitHub API 500"), { status: 500 });
    const mockOctokit = makeMockOctokit({
      git: {
        getRef: vi.fn().mockRejectedValue(serverError),
        createRef: vi.fn(),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await expect(
      capturePreview({
        url: "https://preview.example.com",
        github_repo: "owner/repo",
        pr_number: 1,
      })
    ).rejects.toThrow("GitHub API 500");
    expect(mockOctokit.git.createRef).not.toHaveBeenCalled();
  });
});
