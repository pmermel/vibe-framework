import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock configure-cloud and configure-repo before importing importProject.
// vi.mock factories are hoisted to the top of the file before any variable
// declarations, so we use vi.hoisted() to create references that are available
// at hoist time and in the rest of the test file.
// ---------------------------------------------------------------------------

const { mockConfigureCloud, mockConfigureRepo } = vi.hoisted(() => ({
  mockConfigureCloud: vi.fn(),
  mockConfigureRepo: vi.fn(),
}));

vi.mock("./configure-cloud.js", () => ({
  configureCloud: mockConfigureCloud,
}));

vi.mock("./configure-repo.js", () => ({
  configureRepo: mockConfigureRepo,
}));

// ---------------------------------------------------------------------------
// Mock github-client so tests never make real API calls
// ---------------------------------------------------------------------------

const mockOctokit = {
  users: {
    getByUsername: vi.fn(),
  },
  repos: {
    get: vi.fn(),
    updateBranchProtection: vi.fn(),
    createOrUpdateEnvironment: vi.fn(),
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
    update: vi.fn(),
  },
  issues: {
    createComment: vi.fn(),
  },
  request: vi.fn(),
};

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: () => mockOctokit,
}));

// Mock libsodium-wrappers so configure-repo can load without a real crypto environment
vi.mock("libsodium-wrappers", () => ({
  default: {
    ready: Promise.resolve(),
    crypto_box_seal: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  },
}));

import { importProject } from "./import-project.js";

// ---------------------------------------------------------------------------
// Global env var management
// Set AZURE_SUBSCRIPTION_ID for all tests so the subscription-resolution
// path doesn't throw by default. Individual tests that want to test the
// "not set" path must delete and restore it themselves.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.AZURE_SUBSCRIPTION_ID = "default-sub-123";
});

afterEach(() => {
  Object.keys(process.env).forEach((key) => {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultCloudOutputs = {
  status: "provisioned",
  project_name: "existing-app",
  github_repo: "owner/existing-app",
  resource_group: "existing-app-rg",
  azure_region: "eastus2",
  acr_login_server: "existingappacr.azurecr.io",
  acr_id: "/subscriptions/sub-123/resourceGroups/existing-app-rg/providers/Microsoft.ContainerRegistry/registries/existingappacr",
  staging_fqdn: "existing-app-staging.eastus2.azurecontainerapps.io",
  production_fqdn: "existing-app-prod.eastus2.azurecontainerapps.io",
  oidc_client_ids: {
    preview: "client-preview-123",
    staging: "client-staging-456",
    production: "client-production-789",
  },
  tenant_id: "tenant-abc",
  subscription_id: "sub-123",
};

function setupHappyPath() {
  mockOctokit.repos.get.mockResolvedValue({
    data: {
      name: "existing-app",
      full_name: "owner/existing-app",
      default_branch: "main",
    },
  });

  mockOctokit.git.getRef.mockResolvedValue({
    data: { object: { sha: "commit-abc123" } },
  });

  mockOctokit.git.getCommit.mockResolvedValue({
    data: { tree: { sha: "tree-abc123" } },
  });

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
      html_url: "https://github.com/owner/existing-app/pull/1",
      number: 1,
    },
  });

  mockOctokit.pulls.update.mockResolvedValue({});

  mockOctokit.issues.createComment.mockResolvedValue({
    data: { id: 1, html_url: "https://github.com/owner/existing-app/pull/1#issuecomment-1" },
  });

  mockOctokit.request.mockResolvedValue({});

  mockConfigureCloud.mockResolvedValue(defaultCloudOutputs);
  mockConfigureRepo.mockResolvedValue({ configured: true });
}

// ---------------------------------------------------------------------------
// Tests: valid params — happy path
// ---------------------------------------------------------------------------

describe("importProject — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns status:adopted with github_repo", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(result).toMatchObject({
      status: "adopted",
      github_repo: "owner/existing-app",
    });
  });

  it("returns bootstrap_pr_url in result", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    }) as Record<string, unknown>;

    expect(result.bootstrap_pr_url).toBe("https://github.com/owner/existing-app/pull/1");
  });

  it("returns bootstrap_pr_number in result", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    }) as Record<string, unknown>;

    expect(result.bootstrap_pr_number).toBe(1);
  });

  it("returns cloud_provisioned:true when configureCloud resolves", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    }) as Record<string, unknown>;

    expect(result.cloud_provisioned).toBe(true);
  });

  it("returns repo_configured:true when configureRepo resolves", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    }) as Record<string, unknown>;

    expect(result.repo_configured).toBe(true);
  });

  it("validates repo exists via repos.get", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.repos.get).toHaveBeenCalledWith({
      owner: "owner",
      repo: "existing-app",
    });
  });

  it("creates blobs for framework files", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.git.createBlob.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not commit application files (package.json, src/, Dockerfile)", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    const treeCall = mockOctokit.git.createTree.mock.calls[0]?.[0] as { tree: Array<{ path: string }> };
    const committedPaths = treeCall.tree.map((item) => item.path);

    expect(committedPaths).not.toContain("package.json");
    expect(committedPaths).not.toContain("Dockerfile");
    expect(committedPaths.some((p: string) => p.startsWith("src/"))).toBe(false);
    expect(committedPaths.some((p: string) => p.startsWith("public/"))).toBe(false);
  });

  it("creates bootstrap/vibe-adopt branch (not bootstrap/vibe-setup)", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "refs/heads/bootstrap/vibe-adopt",
      })
    );
  });

  it("creates exactly one branch ref (no develop branch — repo already exists)", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.git.createRef).toHaveBeenCalledTimes(1);
  });

  it("opens PR titled 'chore: adopt vibe-framework' targeting the default branch", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "chore: adopt vibe-framework",
        head: "bootstrap/vibe-adopt",
        base: "main",
        owner: "owner",
        repo: "existing-app",
      })
    );
  });

  it("passes tree SHA (not commit SHA) as base_tree to createTree", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.git.getCommit).toHaveBeenCalledWith(
      expect.objectContaining({ commit_sha: "commit-abc123" })
    );
    expect(mockOctokit.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ base_tree: "tree-abc123" })
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: PR-first ordering
// ---------------------------------------------------------------------------

describe("importProject — PR-first ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("calls pulls.create before configureCloud (PR-first ordering)", async () => {
    const callOrder: string[] = [];
    mockOctokit.pulls.create.mockImplementation(async () => {
      callOrder.push("pulls.create");
      return { data: { html_url: "https://github.com/owner/existing-app/pull/1", number: 1 } };
    });
    mockConfigureCloud.mockImplementation(async () => {
      callOrder.push("configureCloud");
      return defaultCloudOutputs;
    });

    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    const prIndex = callOrder.indexOf("pulls.create");
    const cloudIndex = callOrder.indexOf("configureCloud");
    expect(prIndex).toBeGreaterThanOrEqual(0);
    expect(cloudIndex).toBeGreaterThanOrEqual(0);
    expect(prIndex).toBeLessThan(cloudIndex);
  });

  it("updates PR body with Azure outputs after provisioning succeeds", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    // PR opened first with placeholder body (before provisioning)
    const prCreateCall = mockOctokit.pulls.create.mock.calls[0]?.[0] as { body: string };
    expect(prCreateCall.body).toContain("Azure provisioning in progress");
    expect(prCreateCall.body).not.toContain("azurecr.io");

    // PR updated after provisioning succeeds with real Azure outputs
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 1, owner: "owner", repo: "existing-app" })
    );
    const prUpdateCall = mockOctokit.pulls.update.mock.calls[0]?.[0] as { body: string };
    expect(prUpdateCall.body).toContain("existingappacr.azurecr.io");
    expect(prUpdateCall.body).toContain("existing-app-staging.eastus2.azurecontainerapps.io");
    expect(prUpdateCall.body).toContain("existing-app-prod.eastus2.azurecontainerapps.io");
  });
});

// ---------------------------------------------------------------------------
// Tests: error handling
// ---------------------------------------------------------------------------

describe("importProject — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("posts error comment to PR and re-throws when configureCloud throws", async () => {
    const provisioningError = new Error("ARM deployment failed: quota exceeded");
    mockConfigureCloud.mockRejectedValue(provisioningError);

    await expect(
      importProject({
        github_repo: "owner/existing-app",
        approvers: ["alice"],
        azure_subscription_id: "sub-123",
      })
    ).rejects.toThrow("ARM deployment failed: quota exceeded");

    // PR must have been opened before the failure
    expect(mockOctokit.pulls.create).toHaveBeenCalled();

    // Error comment posted to PR so failure is visible in GitHub
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 1,
        owner: "owner",
        repo: "existing-app",
      })
    );
    const commentBody = (mockOctokit.issues.createComment.mock.calls[0]?.[0] as { body: string }).body;
    expect(commentBody).toContain("Azure provisioning failed");
    expect(commentBody).toContain("ARM deployment failed: quota exceeded");
  });

  it("throws a clear error when neither param nor env var provides subscription ID", async () => {
    delete process.env.AZURE_SUBSCRIPTION_ID;

    await expect(
      importProject({
        github_repo: "owner/existing-app",
        approvers: ["alice"],
        // no azure_subscription_id param
      })
    ).rejects.toThrow("azure_subscription_id is required");

    // No GitHub resources should have been created before the throw
    expect(mockOctokit.repos.get).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
    expect(mockConfigureCloud).not.toHaveBeenCalled();
  });

  it("reads subscription from AZURE_SUBSCRIPTION_ID env var when param omitted", async () => {
    process.env.AZURE_SUBSCRIPTION_ID = "env-sub-999";

    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      // no azure_subscription_id param
    }) as Record<string, unknown>;

    expect(mockConfigureCloud).toHaveBeenCalledWith(
      expect.objectContaining({ azure_subscription_id: "env-sub-999" })
    );
    expect(result.cloud_provisioned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Codespaces enablement — non-fatal
// ---------------------------------------------------------------------------

describe("importProject — Codespaces enablement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("calls Codespaces access API with visibility:all", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/codespaces/access",
      expect.objectContaining({
        owner: "owner",
        repo: "existing-app",
        visibility: "all",
      })
    );
  });

  it("does not throw when Codespaces API fails (non-fatal)", async () => {
    mockOctokit.request.mockRejectedValue(new Error("Codespaces not available"));

    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    }) as Record<string, unknown>;

    expect(result.status).toBe("adopted");
  });
});

// ---------------------------------------------------------------------------
// Tests: cloud and repo orchestration
// ---------------------------------------------------------------------------

describe("importProject — cloud and repo orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("calls configureCloud with correct params", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
      azure_region: "westus2",
    });

    expect(mockConfigureCloud).toHaveBeenCalledWith({
      project_name: "existing-app",
      github_repo: "owner/existing-app",
      azure_subscription_id: "sub-123",
      azure_region: "westus2",
      adapter: "container-app",
    });
  });

  it("calls configureRepo with per-environment azure_client_ids from configureCloud output", async () => {
    await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    expect(mockConfigureRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        github_repo: "owner/existing-app",
        approvers: ["alice"],
        azure_client_ids: {
          preview: "client-preview-123",
          staging: "client-staging-456",
          production: "client-production-789",
        },
        azure_tenant_id: "tenant-abc",
        azure_subscription_id: "sub-123",
      })
    );
  });

  it("does not call configureRepo when configureCloud returns not_implemented", async () => {
    mockConfigureCloud.mockResolvedValue({ status: "not_implemented" });

    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    }) as Record<string, unknown>;

    expect(mockConfigureRepo).not.toHaveBeenCalled();
    expect(result.cloud_provisioned).toBe(false);
    expect(result.repo_configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: invalid params
// ---------------------------------------------------------------------------

describe("importProject — invalid params", () => {
  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      importProject({ approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      importProject({ github_repo: "not-valid-format", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is missing", async () => {
    await expect(
      importProject({ github_repo: "owner/existing-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is empty", async () => {
    await expect(
      importProject({ github_repo: "owner/existing-app", approvers: [] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when template is not a valid enum value", async () => {
    await expect(
      importProject({
        github_repo: "owner/existing-app",
        approvers: ["alice"],
        template: "angular",
      })
    ).rejects.toThrow("Invalid params:");
  });
});
