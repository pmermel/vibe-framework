import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports by Vitest
// ---------------------------------------------------------------------------

// Prevent DefaultAzureCredential from probing local env/managed identity.
// Returns mock tokens that include a fake tid claim for tenant extraction.
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockImplementation(() => {
      const payload = Buffer.from(JSON.stringify({ tid: "tenant-abc" })).toString("base64url");
      return Promise.resolve({ token: `header.${payload}.sig` });
    }),
  })),
}));

// Mock ARM resources client — resource group creation + deployment.
const mockEnvDeploymentResult = {
  properties: {
    outputs: {
      acrLoginServer: { value: "myappacr.azurecr.io" },
      acrId: { value: "/subscriptions/sub-123/resourceGroups/my-app-rg/providers/Microsoft.ContainerRegistry/registries/myappacr" },
      stagingFqdn: { value: "my-app-staging.eastus2.azurecontainerapps.io" },
      productionFqdn: { value: "my-app-prod.eastus2.azurecontainerapps.io" },
    },
  },
};

const mockCreateOrUpdateAndWait = vi.fn().mockResolvedValue(mockEnvDeploymentResult);
const mockRGCreateOrUpdate = vi.fn().mockResolvedValue({});

vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn().mockImplementation(() => ({
    resourceGroups: { createOrUpdate: mockRGCreateOrUpdate },
    deployments: { beginCreateOrUpdateAndWait: mockCreateOrUpdateAndWait },
  })),
}));

// Mock readFileSync — ARM template JSON doesn't need to exist on disk for unit tests.
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    resources: [{ type: "Microsoft.ContainerRegistry/registries" }],
  })),
}));

// Mock global fetch — covers Graph API (app registrations, SPs, FICs) and
// ARM REST API (role assignments). All mocks default to success.
const mockFetch = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
  const method = opts?.method ?? "GET";
  const urlStr = String(url);

  if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "app-object-id", appId: "client-id-mock" }),
    });
  }
  if (urlStr.includes("servicePrincipals") && method === "POST") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "sp-object-id-mock" }),
    });
  }
  if (urlStr.includes("federatedIdentityCredentials") && method === "POST") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  if (urlStr.includes("roleAssignments") && method === "PUT") {
    return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

vi.stubGlobal("fetch", mockFetch);

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
    mockCreateOrUpdateAndWait.mockResolvedValue(mockEnvDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "app-object-id", appId: "client-id-mock" }) });
      }
      if (urlStr.includes("servicePrincipals") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "sp-object-id-mock" }) });
      }
      if (urlStr.includes("federatedIdentityCredentials") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (urlStr.includes("roleAssignments") && method === "PUT") {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
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

  it("returns staging and production FQDNs from deployment outputs", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.staging_fqdn).toBe("my-app-staging.eastus2.azurecontainerapps.io");
    expect(result.production_fqdn).toBe("my-app-prod.eastus2.azurecontainerapps.io");
  });

  it("returns tenant_id extracted from the Graph API JWT token", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.tenant_id).toBe("tenant-abc");
  });

  it("returns oidc_client_ids for preview, staging, and production", async () => {
    const result = await configureCloud(validParams) as Record<string, unknown>;
    const ids = result.oidc_client_ids as Record<string, string>;
    expect(ids.preview).toBe("client-id-mock");
    expect(ids.staging).toBe("client-id-mock");
    expect(ids.production).toBe("client-id-mock");
  });

  it("does NOT write GitHub secrets (that responsibility belongs to configure_repo)", async () => {
    await configureCloud(validParams);
    const calls = mockFetch.mock.calls as Array<[string, ...unknown[]]>;
    const githubCalls = calls.filter(([url]) => String(url).includes("api.github.com"));
    expect(githubCalls).toHaveLength(0);
  });

  it("deploys the ARM template from container-apps-env.json (not an empty stub)", async () => {
    await configureCloud(validParams);
    expect(mockCreateOrUpdateAndWait).toHaveBeenCalledTimes(1);
    const deployCall = mockCreateOrUpdateAndWait.mock.calls[0][2] as Record<string, unknown>;
    const props = deployCall.properties as Record<string, unknown>;
    expect(typeof props.template).toBe("object");
    expect((props.template as Record<string, unknown>)["$schema"]).toContain("deploymentTemplate.json");
  });

  it("creates the resource group with correct name and location", async () => {
    await configureCloud(validParams);
    expect(mockRGCreateOrUpdate).toHaveBeenCalledWith(
      "my-app-rg",
      expect.objectContaining({ location: "eastus2" })
    );
  });

  it("calls Graph API to create app registrations × 3 (one per GitHub environment)", async () => {
    await configureCloud(validParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const appCalls = calls.filter(
      ([url, opts]) =>
        String(url).includes("graph.microsoft.com/v1.0/applications") &&
        !String(url).includes("federatedIdentity") &&
        opts?.method === "POST"
    );
    expect(appCalls).toHaveLength(3);
  });

  it("creates OIDC federated credentials × 3 with correct GitHub subjects", async () => {
    await configureCloud(validParams);
    const calls = mockFetch.mock.calls as Array<[string, { body?: string; method?: string }]>;
    const ficCalls = calls.filter(
      ([url, opts]) =>
        String(url).includes("federatedIdentityCredentials") && opts?.method === "POST"
    );
    expect(ficCalls).toHaveLength(3);
    const subjects = ficCalls.map(([, opts]) => {
      const body = JSON.parse(opts?.body ?? "{}") as { subject?: string };
      return body.subject;
    });
    expect(subjects).toContain("repo:owner/my-app:environment:preview");
    expect(subjects).toContain("repo:owner/my-app:environment:staging");
    expect(subjects).toContain("repo:owner/my-app:environment:production");
  });

  it("assigns Contributor and AcrPush roles × 3 each (6 role assignments total)", async () => {
    await configureCloud(validParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const roleCalls = calls.filter(
      ([url, opts]) => String(url).includes("roleAssignments") && opts?.method === "PUT"
    );
    expect(roleCalls).toHaveLength(6);
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
    mockCreateOrUpdateAndWait.mockResolvedValue(mockEnvDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "app-object-id", appId: "client-id-mock" }) });
      }
      if (urlStr.includes("servicePrincipals") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "sp-object-id-mock" }) });
      }
      if (urlStr.includes("federatedIdentityCredentials") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (urlStr.includes("roleAssignments") && method === "PUT") {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it("surfaces ARM deployment errors", async () => {
    mockCreateOrUpdateAndWait.mockRejectedValueOnce(new Error("ARM deployment failed"));
    await expect(configureCloud(validParams)).rejects.toThrow("ARM deployment failed");
  });

  it("surfaces Graph API app registration errors with a descriptive message", async () => {
    // Allow first two fetch calls (token acquisition stubs) then fail the app creation
    let callCount = 0;
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      callCount++;
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      // Fail the first Graph app creation call
      if (callCount === 1 && urlStr.includes("applications") && method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve("Insufficient privileges"),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "x", appId: "y", tid: "t" }) });
    });
    await expect(configureCloud(validParams)).rejects.toThrow("Graph API: failed to create app registration");
  });

  it("treats 409 Conflict on role assignments as success (idempotent re-run)", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "app-object-id", appId: "client-id-mock" }) });
      }
      if (urlStr.includes("servicePrincipals") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "sp-object-id-mock" }) });
      }
      if (urlStr.includes("federatedIdentityCredentials") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (urlStr.includes("roleAssignments") && method === "PUT") {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    await expect(configureCloud(validParams)).resolves.toMatchObject({ status: "provisioned" });
  });
});
