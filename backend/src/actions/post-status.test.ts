import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: vi.fn(),
}));

import { postStatus } from "./post-status.js";
import { getGithubClient } from "../lib/github-client.js";

function makeMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    issues: {
      createComment: vi.fn().mockResolvedValue({
        data: { id: 999, html_url: "https://github.com/owner/repo/pull/1#issuecomment-999" },
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

describe("postStatus — param validation", () => {
  it("throws Invalid params when github_repo is missing", async () => {
    await expect(postStatus({ pr_number: 1, status: "success", message: "ok" })).rejects.toThrow(
      "Invalid params:"
    );
  });

  it("throws Invalid params when github_repo is not owner/repo format", async () => {
    await expect(
      postStatus({ github_repo: "badformat", pr_number: 1, status: "success", message: "ok" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is missing", async () => {
    await expect(
      postStatus({ github_repo: "owner/repo", status: "success", message: "ok" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when status is an invalid enum value", async () => {
    await expect(
      postStatus({ github_repo: "owner/repo", pr_number: 1, status: "unknown", message: "ok" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when message is missing", async () => {
    await expect(
      postStatus({ github_repo: "owner/repo", pr_number: 1, status: "success" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when preview_url is not a valid URL", async () => {
    await expect(
      postStatus({
        github_repo: "owner/repo",
        pr_number: 1,
        status: "success",
        message: "ok",
        preview_url: "not-a-url",
      })
    ).rejects.toThrow("Invalid params:");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("postStatus — happy path", () => {
  it("posts a success comment and returns posted:true with comment metadata", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 42,
      status: "success",
      message: "Deploy complete",
      preview_url: "https://preview.example.com",
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    expect(result.comment_id).toBe(999);
    expect(result.comment_url).toContain("issuecomment-999");
    expect(result.status).toBe("success");
    expect(result.comment_body).toContain("✅");
    expect(result.comment_body).toContain("Deploy complete");
    expect(result.comment_body).toContain("https://preview.example.com");
  });

  it("posts a failure comment with ❌ emoji", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 1,
      status: "failure",
      message: "Build failed",
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    expect(result.comment_body).toContain("❌");
  });

  it("posts a pending comment with ⏳ emoji", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 1,
      status: "pending",
      message: "Deploying...",
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    expect(result.comment_body).toContain("⏳");
  });

  it("calls createComment with correct owner, repo, and issue_number", async () => {
    const mockOctokit = makeMockOctokit();
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await postStatus({
      github_repo: "myorg/myrepo",
      pr_number: 7,
      status: "success",
      message: "ok",
    });

    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "myorg", repo: "myrepo", issue_number: 7 })
    );
  });

  it("omits preview URL line when preview_url is not provided", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 1,
      status: "success",
      message: "Done",
    })) as Record<string, unknown>;

    expect(result.comment_body).not.toContain("Preview:");
  });

  it("embeds screenshot as markdown image when screenshot_url is provided with preview_url", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 42,
      status: "success",
      message: "Deploy complete",
      preview_url: "https://preview.example.com",
      screenshot_url: "https://myaccount.blob.core.windows.net/screenshots/pr-42/123.png",
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    const body = result.comment_body as string;
    expect(body).toContain("## Preview Status");
    expect(body).toContain("**Preview URL:** https://preview.example.com");
    expect(body).toContain("![Screenshot](https://myaccount.blob.core.windows.net/screenshots/pr-42/123.png)");
  });

  it("embeds screenshot image when screenshot_url provided without preview_url", async () => {
    const result = (await postStatus({
      github_repo: "owner/repo",
      pr_number: 1,
      status: "success",
      message: "Done",
      screenshot_url: "https://myaccount.blob.core.windows.net/screenshots/pr-1/456.png",
    })) as Record<string, unknown>;

    expect(result.posted).toBe(true);
    const body = result.comment_body as string;
    expect(body).toContain("![Screenshot](https://myaccount.blob.core.windows.net/screenshots/pr-1/456.png)");
  });

  it("rejects invalid screenshot_url", async () => {
    await expect(
      postStatus({
        github_repo: "owner/repo",
        pr_number: 1,
        status: "success",
        message: "ok",
        screenshot_url: "not-a-url",
      })
    ).rejects.toThrow("Invalid params:");
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe("postStatus — GitHub API errors", () => {
  it("surfaces GitHub API errors to the caller", async () => {
    const mockOctokit = makeMockOctokit({
      issues: {
        createComment: vi.fn().mockRejectedValue(new Error("GitHub API 403")),
      },
    });
    vi.mocked(getGithubClient).mockReturnValue(mockOctokit as never);

    await expect(
      postStatus({ github_repo: "owner/repo", pr_number: 1, status: "success", message: "ok" })
    ).rejects.toThrow("GitHub API 403");
  });
});
