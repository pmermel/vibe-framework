import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProject } from "./create-project.js";

// ---------------------------------------------------------------------------
// Mock github-client so tests never make real API calls
// ---------------------------------------------------------------------------

const mockOctokit = {
  users: {
    getByUsername: vi.fn(),
  },
  repos: {
    createInOrg: vi.fn(),
    createForAuthenticatedUser: vi.fn(),
  },
  git: {
    getRef: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    createRef: vi.fn(),
  },
  pulls: {
    create: vi.fn(),
  },
};

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: () => mockOctokit,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupHappyPath(ownerType: "User" | "Organization" = "User") {
  mockOctokit.users.getByUsername.mockResolvedValue({ data: { type: ownerType } });

  const createRepoMock = {
    data: {
      html_url: "https://github.com/acme/my-app",
      default_branch: "main",
    },
  };
  mockOctokit.repos.createForAuthenticatedUser.mockResolvedValue(createRepoMock);
  mockOctokit.repos.createInOrg.mockResolvedValue(createRepoMock);

  mockOctokit.git.getRef.mockResolvedValue({
    data: { object: { sha: "abc123" } },
  });

  // Return a unique sha per blob call so tree items have distinct shas
  let blobCount = 0;
  mockOctokit.git.createBlob.mockImplementation(async () => ({
    data: { sha: `blob-sha-${blobCount++}` },
  }));

  mockOctokit.git.createTree.mockResolvedValue({
    data: { sha: "tree-sha" },
  });

  mockOctokit.git.createCommit.mockResolvedValue({
    data: { sha: "commit-sha" },
  });

  mockOctokit.git.createRef.mockResolvedValue({});

  mockOctokit.pulls.create.mockResolvedValue({
    data: {
      html_url: "https://github.com/acme/my-app/pull/1",
      number: 1,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests: valid params — nextjs happy path
// ---------------------------------------------------------------------------

describe("createProject — nextjs happy path (user owner)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("User");
  });

  it("returns repo_url, pr_url, pr_number", async () => {
    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    expect(result).toEqual({
      repo_url: "https://github.com/acme/my-app",
      pr_url: "https://github.com/acme/my-app/pull/1",
      pr_number: 1,
    });
  });

  it("creates the repo with auto_init:true", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.createForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-app", auto_init: true })
    );
  });

  it("creates bootstrap PR targeting the default branch", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        head: "bootstrap/vibe-setup",
        base: "main",
        owner: "acme",
        repo: "my-app",
      })
    );
  });

  it("creates blobs for all scaffold files", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    // Scaffold generates ~15 files — assert at least one blob was created per file
    expect(mockOctokit.git.createBlob.mock.calls.length).toBeGreaterThan(0);
  });

  it("uses createForAuthenticatedUser when owner is a user", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.createForAuthenticatedUser).toHaveBeenCalled();
    expect(mockOctokit.repos.createInOrg).not.toHaveBeenCalled();
  });
});

describe("createProject — nextjs happy path (org owner)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("Organization");
  });

  it("uses createInOrg when owner is an organization", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.createInOrg).toHaveBeenCalledWith(
      expect.objectContaining({ org: "acme-org", name: "my-app", auto_init: true })
    );
    expect(mockOctokit.repos.createForAuthenticatedUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: non-nextjs templates return not_implemented (no API calls)
// ---------------------------------------------------------------------------

describe("createProject — unimplemented templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not_implemented for react-vite (Phase 4 deferred)", async () => {
    const result = await createProject({
      name: "my-app",
      template: "react-vite",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
    expect(mockOctokit.repos.createForAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("returns not_implemented for node-api (Phase 4 deferred)", async () => {
    const result = await createProject({
      name: "my-app",
      template: "node-api",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
    expect(mockOctokit.repos.createForAuthenticatedUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: invalid params
// ---------------------------------------------------------------------------

describe("createProject — invalid params", () => {
  it("throws Invalid params when name is missing", async () => {
    await expect(
      createProject({ template: "nextjs", github_owner: "acme", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when template is missing", async () => {
    await expect(
      createProject({ name: "my-app", github_owner: "acme", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when template is not a valid enum value", async () => {
    await expect(
      createProject({ name: "my-app", template: "angular", github_owner: "acme", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_owner is missing", async () => {
    await expect(
      createProject({ name: "my-app", template: "nextjs", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is missing", async () => {
    await expect(
      createProject({ name: "my-app", template: "nextjs", github_owner: "acme" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is empty", async () => {
    await expect(
      createProject({ name: "my-app", template: "nextjs", github_owner: "acme", approvers: [] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when adapter is not a valid enum value", async () => {
    await expect(
      createProject({
        name: "my-app",
        template: "nextjs",
        github_owner: "acme",
        approvers: ["alice"],
        adapter: "serverless",
      })
    ).rejects.toThrow("Invalid params:");
  });
});
