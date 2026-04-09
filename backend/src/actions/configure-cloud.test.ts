import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports by Vitest
// ---------------------------------------------------------------------------

// Prevent libsodium-wrappers from initializing in the test environment.
vi.mock("libsodium-wrappers", () => ({
  default: {
    ready: Promise.resolve(),
    crypto_box_seal: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  },
}));

// Prevent DefaultAzureCredential from probing local env/managed identity.
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({})),
}));

// Mock ARM resources client — provide deployments.beginCreateOrUpdateAndWait
// and resourceGroups.createOrUpdate.
const mockDeploymentResult = {
  properties: {
    outputs: {
      acrLoginServer: { value: "myappacr.azurecr.io" },
      acrId: { value: "/subscriptions/sub-123/resourceGroups/my-app-rg/providers/Microsoft.ContainerRegistry/registries/myappacr" },
      stagingFqdn: { value: "my-app-staging.eastus2.azurecontainerapps.io" },
      productionFqdn: { value: "my-app-prod.eastus2.azurecontainerapps.io" },
      clientId: { value: "client-id-preview" },
      principalId: { value: "principal-id-preview" },
      tenantId: { value: "tenant-123" },
    },
  },
};

const mockCreateOrUpdateAndWait = vi.fn().mockResolvedValue(mockDeploymentResult);
const mockRGCreateOrUpdate = vi.fn().mockResolvedValue({});

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    resourceGroups: { createOrUpdate: mockRGCreateOrUpdate },
    deployments: { beginCreateOrUpdateAndWait: mockCreateOrUpdateAndWait },
  })),
}));

// Mock GitHub client — prevent real API calls for environment secrets.
const mockGetEnvironmentPublicKey = vi.fn().mockResolvedValue({
  data: { key: Buffer.from("a".repeat(32)).toString("base64"), key_id: "key-1" },
});
const mockCreateOrUpdateEnvironmentSecret = vi.fn().mockResolvedValue({});

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: () => ({
    actions: {
      getEnvironmentPublicKey: mockGetEnvironmentPublicKey,
      createOrUpdateEnvironmentSecret: mockCreateOrUpdateEnvironmentSecret,
    },
  }),
}));

// Mock readFileSync — bicep templates don't need to exist on disk for unit tests.
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("# mock bicep content"),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { configureCloud } from "./configure-cloud.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("configureCloud — param validation", () => {
  it("throws Invalid params when project_name is missing", async () => {
    await expect(
      configureCloud({ github_repo: "owner/my-app", azure_subscription_id: "sub-123" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      configureCloud({ project_name: "my-app", azure_subscription_id: "sub-123" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      configureCloud({ project_name: "my-app", github_repo: "notvalid", azure_subscription_id: "sub-123" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when azure_subscription_id is missing", async () => {
    await expect(
      configureCloud({ project_name: "my-app", github_repo: "owner/my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when adapter is not a valid enum value", async () => {
    await expect(
      configureCloud({
        project_name: "my-app",
        github_repo: "owner/my-app",
        azure_subscription_id: "sub-123",
        adapter: "unknown",
      })
    ).rejects.toThrow("Invalid params:");
  });
});

describe("configureCloud — static-web-app adapter (deferred)", () => {
  it("returns not_implemented for static-web-app", async () => {
    const result = await configureCloud({
      project_name: "my-app",
      github_repo: "owner/my-app",
      azure_subscription_id: "sub-123",
      adapter: "static-web-app",
    });
    expect(result).toMatchObject({ status: "not_implemented" });
  });
});

describe("configureCloud — happy path (container-app)", () => {
  const validParams = {
    project_name: "my-app",
    github_repo: "owner/my-app",
    azure_subscription_id: "sub-123",
    azure_region: "eastus2",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateAndWait.mockResolvedValue(mockDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: { key: Buffer.from("a".repeat(32)).toString("base64"), key_id: "key-1" },
    });
    mockCreateOrUpdateEnvironmentSecret.mockResolvedValue({});
  });

  it("returns status:provisioned with resource group and region", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.status).toBe("provisioned");
    expect(result.resource_group).toBe("my-app-rg");
    expect(result.azure_region).toBe("eastus2");
  });

  it("returns acr_login_server from deployment outputs", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.acr_login_server).toBe("myappacr.azurecr.io");
  });

  it("returns staging and production FQDNs", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.staging_fqdn).toBe("my-app-staging.eastus2.azurecontainerapps.io");
    expect(result.production_fqdn).toBe("my-app-prod.eastus2.azurecontainerapps.io");
  });

  it("deploys container-apps-env.bicep then oidc × 3 (four total deployments)", async () => {
    await configureCloud(validParams);
    // First call is container-apps-env, then 3× oidc (preview, staging, production)
    expect(mockCreateOrUpdateAndWait).toHaveBeenCalledTimes(4);
    const firstCall = mockCreateOrUpdateAndWait.mock.calls[0] as unknown[];
    expect(firstCall[1]).toContain("env-deploy");
  });

  it("deploys oidc-federated-credential.bicep for preview, staging, and production", async () => {
    await configureCloud(validParams);
    const deploymentNames = mockCreateOrUpdateAndWait.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(deploymentNames).toContain("my-app-oidc-preview");
    expect(deploymentNames).toContain("my-app-oidc-staging");
    expect(deploymentNames).toContain("my-app-oidc-production");
  });

  it("stores AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID on each environment (9 secret writes)", async () => {
    await configureCloud(validParams);
    // 3 environments × 3 secrets = 9 calls
    expect(mockCreateOrUpdateEnvironmentSecret).toHaveBeenCalledTimes(9);
    const secretNames = mockCreateOrUpdateEnvironmentSecret.mock.calls.map(
      (c: unknown[]) => (c[0] as Record<string, unknown>).secret_name
    );
    const uniqueSecrets = [...new Set(secretNames)];
    expect(uniqueSecrets).toContain("AZURE_CLIENT_ID");
    expect(uniqueSecrets).toContain("AZURE_TENANT_ID");
    expect(uniqueSecrets).toContain("AZURE_SUBSCRIPTION_ID");
  });

  it("returns secrets_stored listing preview, staging, and production", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    const secretsStored = result.secrets_stored as Array<{ environment: string; secrets: string[] }>;
    const envs = secretsStored.map((s) => s.environment);
    expect(envs).toContain("preview");
    expect(envs).toContain("staging");
    expect(envs).toContain("production");
  });

  it("creates the resource group with correct name and location", async () => {
    await configureCloud(validParams);
    expect(mockRGCreateOrUpdate).toHaveBeenCalledWith(
      "my-app-rg",
      expect.objectContaining({ location: "eastus2" })
    );
  });

  it("uses the provided azure_region when overriding the default", async () => {
    await configureCloud({ ...validParams, azure_region: "westus2" });
    expect(mockRGCreateOrUpdate).toHaveBeenCalledWith(
      "my-app-rg",
      expect.objectContaining({ location: "westus2" })
    );
  });
});

describe("configureCloud — error propagation", () => {
  const validParams = {
    project_name: "my-app",
    github_repo: "owner/my-app",
    azure_subscription_id: "sub-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateAndWait.mockResolvedValue(mockDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockGetEnvironmentPublicKey.mockResolvedValue({
      data: { key: Buffer.from("a".repeat(32)).toString("base64"), key_id: "key-1" },
    });
    mockCreateOrUpdateEnvironmentSecret.mockResolvedValue({});
  });

  it("surfaces Azure deployment errors", async () => {
    mockCreateOrUpdateAndWait.mockRejectedValueOnce(new Error("Azure deployment failed"));
    await expect(configureCloud(validParams)).rejects.toThrow("Azure deployment failed");
  });

  it("surfaces GitHub secret storage errors", async () => {
    mockGetEnvironmentPublicKey.mockRejectedValueOnce(new Error("GitHub API rate limited"));
    await expect(configureCloud(validParams)).rejects.toThrow("GitHub API rate limited");
  });
});
