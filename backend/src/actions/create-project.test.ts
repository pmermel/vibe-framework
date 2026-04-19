import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Flushes the setImmediate background task started by createProject.
 * createProject returns immediately after opening the PR, then kicks off
 * configureCloud + configureRepo in a setImmediate callback. Tests that
 * assert on those calls must await this helper first.
 */
const flushBackground = async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  // Drain microtasks for all awaits inside provisionInBackground
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

// ---------------------------------------------------------------------------
// Mock configure-cloud and configure-repo before importing createProject.
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

import { createProject } from "./create-project.js";

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
  // Restore env to whatever it was before each test
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
  project_name: "my-app",
  github_repo: "acme/my-app",
  resource_group: "my-app-rg",
  azure_region: "eastus2",
  acr_login_server: "myappackr.azurecr.io",
  acr_id: "/subscriptions/sub-123/resourceGroups/my-app-rg/providers/Microsoft.ContainerRegistry/registries/myappackr",
  staging_fqdn: "my-app-staging.eastus2.azurecontainerapps.io",
  production_fqdn: "my-app-prod.eastus2.azurecontainerapps.io",
  oidc_client_ids: {
    preview: "client-preview-123",
    staging: "client-staging-456",
    production: "client-production-789",
  },
  tenant_id: "tenant-abc",
  subscription_id: "sub-123",
};

const swaCloudOutputs = {
  status: "provisioned",
  project_name: "my-site",
  github_repo: "acme/my-site",
  resource_group: "my-site-rg",
  azure_region: "eastus2",
  swa_hostname: "gentle-wave-abc.azurestaticapps.net",
  swa_id: "/subscriptions/sub-123/resourceGroups/my-site-rg/providers/Microsoft.Web/staticSites/my-site-swa",
  // deployment_token intentionally absent — fetched at runtime by reusable-swa-*.yml workflows
  oidc_client_ids: {
    preview: "client-preview-111",
    staging: "client-staging-222",
    production: "client-production-333",
  },
  tenant_id: "tenant-abc",
  subscription_id: "sub-123",
};

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

  mockOctokit.pulls.update.mockResolvedValue({});
  mockOctokit.issues.createComment.mockResolvedValue({
    data: { id: 999, html_url: "https://github.com/acme/my-app/pull/1#issuecomment-999" },
  });

  // Codespaces API — succeed by default
  mockOctokit.request.mockResolvedValue({});

  // configure-cloud and configure-repo — succeed by default with realistic outputs
  mockConfigureCloud.mockResolvedValue(defaultCloudOutputs);
  mockConfigureRepo.mockResolvedValue({ configured: true });
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

    expect(result).toMatchObject({
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

  it("creates develop branch (from scaffold commit SHA) and bootstrap branch (from same commit SHA) via two createRef calls", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });

    // createRef must be called exactly twice: once for develop, once for bootstrap/vibe-setup
    expect(mockOctokit.git.createRef).toHaveBeenCalledTimes(2);

    // First call: develop branch pointing at the scaffold commit SHA (not the empty init commit)
    // so develop already contains the generated project from day one.
    expect(mockOctokit.git.createRef).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ref: "refs/heads/develop",
        sha: "commit-sha",
      })
    );

    // Second call: bootstrap branch pointing at the same scaffold commit SHA
    expect(mockOctokit.git.createRef).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ref: "refs/heads/bootstrap/vibe-setup",
        sha: "commit-sha",
      })
    );
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

  it("returns not_implemented for nextjs + static-web-app (invalid combo)", async () => {
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

  it("returns not_implemented for node-api + static-web-app (invalid combo)", async () => {
    const result = await createProject({
      name: "my-app",
      template: "node-api",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
    expect(mockOctokit.repos.createForAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("returns not_implemented for react-vite + container-app (invalid combo)", async () => {
    const result = await createProject({
      name: "my-app",
      template: "react-vite",
      adapter: "container-app",
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

// ---------------------------------------------------------------------------
// Tests: Codespaces enablement
// ---------------------------------------------------------------------------

describe("createProject — Codespaces enablement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("Organization");
  });

  it("calls Codespaces access API with visibility:all after repo creation", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
    });

    expect(mockOctokit.request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/codespaces/access",
      expect.objectContaining({
        owner: "acme-org",
        repo: "my-app",
        visibility: "all",
      })
    );
  });

  it("does not throw when Codespaces API fails (non-fatal warning)", async () => {
    mockOctokit.request.mockRejectedValue(new Error("Codespaces not available"));

    // Should not throw — Codespaces failure is swallowed
    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
    });

    expect(result).toHaveProperty("repo_url");
  });
});

// ---------------------------------------------------------------------------
// Tests: configureCloud and configureRepo orchestration
// ---------------------------------------------------------------------------

describe("createProject — cloud and repo orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("Organization");
  });

  it("calls configureCloud with correct params when azure_subscription_id is provided", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
      azure_region: "westus2",
    });
    await flushBackground();

    expect(mockConfigureCloud).toHaveBeenCalledWith({
      project_name: "my-app",
      github_repo: "acme-org/my-app",
      azure_subscription_id: "sub-123",
      azure_region: "westus2",
      adapter: "container-app",
    });
  });

  it("supports node-api on the container-app path", async () => {
    const result = (await createProject({
      name: "my-app",
      template: "node-api",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    })) as Record<string, unknown>;
    await flushBackground();

    expect(result).toHaveProperty("repo_url");
    expect(mockConfigureCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        project_name: "my-app",
        github_repo: "acme-org/my-app",
        adapter: "container-app",
      })
    );
  });

  it("creates a node-api scaffold when template is node-api", async () => {
    await createProject({
      name: "my-app",
      template: "node-api",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    const blobBodies = mockOctokit.git.createBlob.mock.calls.map(
      ([payload]: [{ content: string }]) => payload.content
    );

    expect(blobBodies.some((content: string) => content.includes("template: node-api"))).toBe(true);
    expect(blobBodies.some((content: string) => content.includes("express"))).toBe(true);
  });

  it("calls configureRepo with per-environment azure_client_ids from configureCloud output", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });
    await flushBackground();

    expect(mockConfigureRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        github_repo: "acme-org/my-app",
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

  it("returns status:provisioning immediately (provisioning runs in background)", async () => {
    const result = (await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    })) as Record<string, unknown>;

    expect(result.status).toBe("provisioning");
    expect(result).toHaveProperty("repo_url");
    expect(result).toHaveProperty("pr_url");
    expect(result).toHaveProperty("message");
  });

  it("throws a clear error when azure_subscription_id is absent and AZURE_SUBSCRIPTION_ID env var is not set", async () => {
    delete process.env.AZURE_SUBSCRIPTION_ID; // override the global beforeEach default

    await expect(
      createProject({
        name: "my-app",
        template: "nextjs",
        github_owner: "acme-org",
        approvers: ["alice"],
      })
    ).rejects.toThrow("azure_subscription_id is required");

    // No GitHub or Azure resources should have been created
    expect(mockOctokit.repos.createInOrg).not.toHaveBeenCalled();
    expect(mockConfigureCloud).not.toHaveBeenCalled();
  });

  it("reads subscription from AZURE_SUBSCRIPTION_ID env var when param is omitted", async () => {
    process.env.AZURE_SUBSCRIPTION_ID = "env-sub-999"; // override the global default

    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      // no azure_subscription_id param
    });
    await flushBackground();

    expect(mockConfigureCloud).toHaveBeenCalledWith(
      expect.objectContaining({ azure_subscription_id: "env-sub-999" })
    );
  });

  it("does not call configureRepo when configureCloud returns not_implemented", async () => {
    mockConfigureCloud.mockResolvedValue({ status: "not_implemented" });

    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });
    await flushBackground();

    expect(mockConfigureRepo).not.toHaveBeenCalled();
  });

  it("opens bootstrap PR first with placeholder body, then updates with Azure outputs after provisioning", async () => {
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    // PR opened first with placeholder body (before provisioning)
    const prCreateCall = mockOctokit.pulls.create.mock.calls[0]?.[0] as { body: string };
    expect(prCreateCall.body).toContain("Azure OIDC trust");
    expect(prCreateCall.body).not.toContain("azurecr.io");

    // Wait for background provisioning to complete
    await flushBackground();

    // PR updated after provisioning succeeds with real Azure outputs
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 1, owner: "acme-org", repo: "my-app" })
    );
    const prUpdateCall = mockOctokit.pulls.update.mock.calls[0]?.[0] as { body: string };
    expect(prUpdateCall.body).toContain("myappackr.azurecr.io");
    expect(prUpdateCall.body).toContain("my-app-staging.eastus2.azurecontainerapps.io");
    expect(prUpdateCall.body).toContain("my-app-prod.eastus2.azurecontainerapps.io");
  });

  it("opens PR with placeholder body first, then updates it after provisioning succeeds", async () => {
    // PR created with placeholder, then updated — both must be called
    await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    const prCreateCall = mockOctokit.pulls.create.mock.calls[0]?.[0] as { body: string };
    expect(prCreateCall.body).toContain("Azure OIDC trust");
    expect(prCreateCall.body).not.toContain("azurecr.io");

    await flushBackground();

    expect(mockOctokit.pulls.update).toHaveBeenCalled();
  });

  it("posts error comment to PR when configureCloud fails (does not re-throw — runs in background)", async () => {
    const provisioningError = new Error("ARM deployment failed: quota exceeded");
    mockConfigureCloud.mockRejectedValue(provisioningError);

    // createProject itself does NOT reject — it returns immediately with status:provisioning
    // and runs provisioning in the background via setImmediate
    const result = (await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme-org",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    })) as Record<string, unknown>;

    expect(result.status).toBe("provisioning");

    // PR must have been opened before the failure
    expect(mockOctokit.pulls.create).toHaveBeenCalled();

    // Wait for background provisioning to run and fail
    await flushBackground();

    // Error comment posted to PR so failure is visible in GitHub
    expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 1,
        owner: "acme-org",
        repo: "my-app",
      })
    );
    // Find the error comment (not the "started" comment)
    const errorCommentCall = (mockOctokit.issues.createComment.mock.calls as Array<[{ body: string }]>)
      .find(([payload]) => payload.body.includes("Azure provisioning failed"));
    expect(errorCommentCall).toBeDefined();
    const commentBody = errorCommentCall![0].body;
    expect(commentBody).toContain("Azure provisioning failed");
    expect(commentBody).toContain("ARM deployment failed: quota exceeded");
  });
});

// ---------------------------------------------------------------------------
// Tests: react-vite + static-web-app path
// ---------------------------------------------------------------------------

describe("createProject — react-vite on the static-web-app path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath("Organization", "acme");
    mockConfigureCloud.mockResolvedValue(swaCloudOutputs);
    mockConfigureRepo.mockResolvedValue({ configured: true, swa_token_configured: true });
  });

  it("supports react-vite + static-web-app and returns repo_url", async () => {
    const result = (await createProject({
      name: "my-site",
      template: "react-vite",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    })) as Record<string, unknown>;

    expect(result).toHaveProperty("repo_url");
    expect(result.status).toBe("provisioning");
    await flushBackground();
  });

  it("calls configureCloud with adapter: static-web-app", async () => {
    await createProject({
      name: "my-site",
      template: "react-vite",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });
    await flushBackground();

    expect(mockConfigureCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        project_name: "my-site",
        adapter: "static-web-app",
      })
    );
  });

  it("does NOT pass swa_deployment_token to configureRepo (token is fetched at runtime)", async () => {
    await createProject({
      name: "my-site",
      template: "react-vite",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });
    await flushBackground();

    const repoCall = mockConfigureRepo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(repoCall).not.toHaveProperty("swa_deployment_token");
  });

  it("creates a react-vite scaffold when template is react-vite", async () => {
    await createProject({
      name: "my-site",
      template: "react-vite",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });

    const blobBodies = mockOctokit.git.createBlob.mock.calls.map(
      ([payload]: [{ content: string }]) => payload.content
    );

    expect(blobBodies.some((content: string) => content.includes("template: react-vite"))).toBe(true);
    expect(blobBodies.some((content: string) => content.includes("react"))).toBe(true);
  });

  it("configureRepo is called without deployment_token in any form", async () => {
    await createProject({
      name: "my-site",
      template: "react-vite",
      adapter: "static-web-app",
      github_owner: "acme",
      approvers: ["alice"],
      azure_subscription_id: "sub-123",
    });
    await flushBackground();

    const repoCall = mockConfigureRepo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(repoCall).not.toHaveProperty("swa_deployment_token");
    expect(repoCall).not.toHaveProperty("deployment_token");
  });
});
