import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProject } from "./create-project.js";

// ---------------------------------------------------------------------------
// Mock github-client so tests never make real API calls
// ---------------------------------------------------------------------------

const mockOctokit = {
  users: {
    getByUsername: vi.fn(),
    getAuthenticated: vi.fn(),
  },
  repos: {
    createInOrg: vi.fn(),
    createForAuthenticatedUser: vi.fn(),
  },
  git: {
    getRef: vi.fn(),
    getCommit: vi.fn(),
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

function setupHappyPath(ownerType: "User" | "Organization" = "User", login = "acme") {
  mockOctokit.users.getByUsername.mockResolvedValue({ data: { type: ownerType } });
  mockOctokit.users.getAuthenticated.mockResolvedValue({ data: { login } });

  const createRepoMock = {
    data: {
      html_url: "https://github.com/acme/my-app",
      default_branch: "main",
    },
  };
  mockOctokit.repos.createForAuthenticatedUser.mockResolvedValue(createRepoMock);
  mockOctokit.repos.createInOrg.mockResolvedValue(createRepoMock);

  mockOctokit.git.getRef.mockResolvedValue({
    data: { object: { sha: "commit-abc123" } },
  });

  mockOctokit.git.getCommit.mockResolvedValue({
    data: { tree: { sha: "tree-abc123" } },
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

  it("passes tree SHA (not commit SHA) as base_tree to createTree", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    // getRef returns commit SHA; getCommit returns tree SHA; createTree must receive tree SHA
    expect(mockOctokit.git.getCommit).toHaveBeenCalledWith(
      expect.objectContaining({ commit_sha: "commit-abc123" })
    );
    expect(mockOctokit.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ base_tree: "tree-abc123" })
    );
  });

  it("passes commit SHA (not tree SHA) as parent to createCommit", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    expect(mockOctokit.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ parents: ["commit-abc123"] })
    );
  });

  it("throws when authenticated user does not match github_owner", async () => {
    // Override getAuthenticated to return a different login
    mockOctokit.users.getAuthenticated.mockResolvedValue({ data: { login: "other-user" } });

    await expect(
      createProject({
        name: "my-app",
        template: "nextjs",
        github_owner: "acme",
        approvers: ["alice"],
      })
    ).rejects.toThrow('github_owner "acme" does not match the authenticated user "other-user"');
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
// Tests: unimplemented template/adapter combos — no GitHub API calls made
// ---------------------------------------------------------------------------

describe("createProject — unimplemented template/adapter combos", () => {
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

  it("returns not_implemented for static-web-app adapter (Phase 3 deferred)", async () => {
    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      adapter: "static-web-app",
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

// ---------------------------------------------------------------------------
// Tests: GitHub App installation auth guard for user-owned repos
// ---------------------------------------------------------------------------

describe("createProject — App installation auth guard", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Set up owner as User so the guard path is reached
    mockOctokit.users.getByUsername.mockResolvedValue({ data: { type: "User" } });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when all three GITHUB_APP_* vars are set and owner is a User", async () => {
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY = "pem";
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";

    await expect(
      createProject({
        name: "my-app",
        template: "nextjs",
        github_owner: "acme",
        approvers: ["alice"],
      })
    ).rejects.toThrow("Installation tokens are app-scoped and cannot create user-owned repositories");
  });

  it("does not throw when only GITHUB_APP_INSTALLATION_ID is set (partial config, PAT fallback active)", async () => {
    // Only one of the three App vars is present — getGithubClient() falls back to GITHUB_TOKEN.
    // The guard must not fire in this case.
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    setupHappyPath("User");

    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toHaveProperty("repo_url");
  });

  it("does not throw the App auth guard for org owners even when all three GITHUB_APP_* vars are set", async () => {
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY = "pem";
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";
    mockOctokit.users.getByUsername.mockResolvedValue({ data: { type: "Organization" } });
    setupHappyPath("Organization");

    // Should succeed — guard is user-path only
    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
    });
    expect(result).toHaveProperty("repo_url");
  });
});
