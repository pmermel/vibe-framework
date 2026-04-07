import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the GitHub client before importing the module under test so the module
// never tries to read real env vars or make real HTTP calls.
// ---------------------------------------------------------------------------
vi.mock("../lib/github-client.js", () => ({
  getGithubClient: vi.fn(),
}));

import { configureRepo } from "./configure-repo.js";
import { getGithubClient } from "../lib/github-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    repos: {
      updateBranchProtection: vi.fn().mockResolvedValue({}),
      createOrUpdateEnvironment: vi.fn().mockResolvedValue({}),
    },
    users: {
      getByUsername: vi.fn().mockResolvedValue({ data: { id: 42, login: "alice" } }),
    },
    issues: {
      createLabel: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("configureRepo — valid params", () => {
  let mockOctokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    mockOctokit = makeMockOctokit();
    (getGithubClient as ReturnType<typeof vi.fn>).mockReturnValue(mockOctokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns configured:true with correct shape on success", async () => {
    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    expect(result).toMatchObject({
      configured: true,
      repo: "owner/my-app",
      branch_protections: expect.arrayContaining(["main", "develop"]),
      environments: expect.arrayContaining(["preview", "staging", "production"]),
      labels_created: expect.any(Number),
    });
  });

  it("returns exactly the three standard environments", async () => {
    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    })) as { environments: string[] };

    expect(result.environments).toHaveLength(3);
    expect(result.environments).toContain("preview");
    expect(result.environments).toContain("staging");
    expect(result.environments).toContain("production");
  });

  it("branch_protections contains production_branch and staging_branch defaults", async () => {
    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    })) as { branch_protections: string[] };

    expect(result.branch_protections).toContain("main");
    expect(result.branch_protections).toContain("develop");
  });

  it("respects custom staging_branch and production_branch", async () => {
    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
      staging_branch: "staging",
      production_branch: "production",
    })) as { branch_protections: string[] };

    expect(result.branch_protections).toContain("staging");
    expect(result.branch_protections).toContain("production");
    expect(result.branch_protections).not.toContain("main");
    expect(result.branch_protections).not.toContain("develop");
  });

  it("accepts multiple approvers", async () => {
    // Stub each approver lookup to return a distinct ID
    mockOctokit.users.getByUsername = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 1, login: "alice" } })
      .mockResolvedValueOnce({ data: { id: 2, login: "bob" } })
      .mockResolvedValueOnce({ data: { id: 3, login: "carol" } });

    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice", "bob", "carol"],
    });

    expect(result).toMatchObject({ configured: true });
  });
});

describe("configureRepo — branch protection calls", () => {
  let mockOctokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    mockOctokit = makeMockOctokit();
    (getGithubClient as ReturnType<typeof vi.fn>).mockReturnValue(mockOctokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateBranchProtection for both branches", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.updateBranchProtection).toHaveBeenCalledTimes(2);
  });

  it("applies branch protection to production_branch (main by default)", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.updateBranchProtection.mock.calls as Array<
      [{ branch: string }]
    >;
    const branches = calls.map(([args]) => args.branch);
    expect(branches).toContain("main");
  });

  it("applies branch protection to staging_branch (develop by default)", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.updateBranchProtection.mock.calls as Array<
      [{ branch: string }]
    >;
    const branches = calls.map(([args]) => args.branch);
    expect(branches).toContain("develop");
  });

  it("requires at least 1 approval in branch protection payload", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.updateBranchProtection.mock.calls as Array<
      [{ required_pull_request_reviews: { required_approving_review_count: number } }]
    >;
    for (const [args] of calls) {
      expect(
        args.required_pull_request_reviews.required_approving_review_count
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("sets dismiss_stale_reviews in branch protection payload", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.updateBranchProtection.mock.calls as Array<
      [{ required_pull_request_reviews: { dismiss_stale_reviews: boolean } }]
    >;
    for (const [args] of calls) {
      expect(args.required_pull_request_reviews.dismiss_stale_reviews).toBe(true);
    }
  });
});

describe("configureRepo — environment creation", () => {
  let mockOctokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    mockOctokit = makeMockOctokit();
    (getGithubClient as ReturnType<typeof vi.fn>).mockReturnValue(mockOctokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls createOrUpdateEnvironment exactly 3 times (preview, staging, production)", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.createOrUpdateEnvironment).toHaveBeenCalledTimes(3);
  });

  it("creates the preview environment", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.createOrUpdateEnvironment.mock.calls as Array<
      [{ environment_name: string }]
    >;
    const envNames = calls.map(([args]) => args.environment_name);
    expect(envNames).toContain("preview");
  });

  it("creates the staging environment", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.createOrUpdateEnvironment.mock.calls as Array<
      [{ environment_name: string }]
    >;
    const envNames = calls.map(([args]) => args.environment_name);
    expect(envNames).toContain("staging");
  });

  it("creates the production environment with required reviewers", async () => {
    mockOctokit.users.getByUsername = vi
      .fn()
      .mockResolvedValue({ data: { id: 99, login: "alice" } });

    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.repos.createOrUpdateEnvironment.mock.calls as Array<
      [{ environment_name: string; reviewers?: Array<{ type: string; id: number }> }]
    >;
    const productionCall = calls.find(([args]) => args.environment_name === "production");
    expect(productionCall).toBeDefined();
    const [productionArgs] = productionCall!;
    expect(productionArgs.reviewers).toBeDefined();
    expect(productionArgs.reviewers).toContainEqual({ type: "User", id: 99 });
  });

  it("resolves approver user IDs via getByUsername", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.users.getByUsername).toHaveBeenCalledWith({ username: "alice" });
  });

  it("skips approver gracefully if user lookup fails", async () => {
    mockOctokit.users.getByUsername = vi.fn().mockRejectedValue({ status: 404 });

    // Should not throw — just skips that approver
    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["nonexistent"],
    });

    expect(result).toMatchObject({ configured: true });
  });
});

describe("configureRepo — label creation", () => {
  let mockOctokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    mockOctokit = makeMockOctokit();
    (getGithubClient as ReturnType<typeof vi.fn>).mockReturnValue(mockOctokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates all 9 standard labels when none exist", async () => {
    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    })) as { labels_created: number };

    expect(mockOctokit.issues.createLabel).toHaveBeenCalledTimes(9);
    expect(result.labels_created).toBe(9);
  });

  it("creates phase labels (phase-2, phase-3, phase-4)", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.issues.createLabel.mock.calls as Array<
      [{ name: string }]
    >;
    const names = calls.map(([args]) => args.name);
    expect(names).toContain("phase-2");
    expect(names).toContain("phase-3");
    expect(names).toContain("phase-4");
  });

  it("creates type labels (feat, fix, chore, infra, test, docs)", async () => {
    await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });

    const calls = mockOctokit.issues.createLabel.mock.calls as Array<
      [{ name: string }]
    >;
    const names = calls.map(([args]) => args.name);
    for (const label of ["feat", "fix", "chore", "infra", "test", "docs"]) {
      expect(names).toContain(label);
    }
  });

  it("skips labels that already exist (422) without throwing", async () => {
    // All labels already exist — every createLabel call returns 422
    mockOctokit.issues.createLabel = vi.fn().mockRejectedValue({ status: 422 });

    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    })) as { labels_created: number; configured: boolean };

    expect(result.configured).toBe(true);
    expect(result.labels_created).toBe(0);
  });

  it("counts only newly created labels in labels_created", async () => {
    let callCount = 0;
    mockOctokit.issues.createLabel = vi.fn().mockImplementation(() => {
      callCount++;
      // Simulate 3 labels already existing (422) and the rest created successfully
      if (callCount <= 3) {
        return Promise.reject({ status: 422 });
      }
      return Promise.resolve({});
    });

    const result = (await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    })) as { labels_created: number };

    expect(result.labels_created).toBe(6); // 9 total - 3 skipped
  });

  it("re-throws non-422 errors from createLabel", async () => {
    const networkError = { status: 500, message: "Internal Server Error" };
    mockOctokit.issues.createLabel = vi.fn().mockRejectedValue(networkError);

    await expect(
      configureRepo({ github_repo: "owner/my-app", approvers: ["alice"] })
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("configureRepo — invalid params", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(configureRepo({ approvers: ["alice"] })).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is missing", async () => {
    await expect(configureRepo({ github_repo: "owner/my-app" })).rejects.toThrow(
      "Invalid params:"
    );
  });

  it("throws Invalid params when approvers is empty", async () => {
    await expect(
      configureRepo({ github_repo: "owner/my-app", approvers: [] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      configureRepo({ github_repo: "notvalid", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is not an array", async () => {
    await expect(
      configureRepo({ github_repo: "owner/my-app", approvers: "alice" })
    ).rejects.toThrow("Invalid params:");
  });
});
