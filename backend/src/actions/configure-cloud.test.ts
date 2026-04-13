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

const mockSwaDeploymentResult = {
  properties: {
    outputs: {
      defaultHostname: { value: "gentle-wave-abc.azurestaticapps.net" },
      swaId: { value: "/subscriptions/sub-123/resourceGroups/my-app-rg/providers/Microsoft.Web/staticSites/my-app-swa" },
      deploymentToken: { value: "swa-token-abc123" },
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
// ARM REST API (role assignments). All mocks default to "not found then create" — the
// idempotent lookup (GET) returns { value: [] }, triggering the create (POST) path.
const mockFetch = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
  const method = opts?.method ?? "GET";
  const urlStr = String(url);

  // Idempotency lookups — return empty list so create path is exercised by default
  if (method === "GET" && urlStr.includes("$filter")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
  }
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

describe("configureCloud — static-web-app adapter", () => {
  const swaParams = {
    project_name: "my-app",
    github_repo: "owner/my-app",
    azure_subscription_id: "sub-123",
    azure_region: "eastus2",
    adapter: "static-web-app",
  };

  function makeDefaultFetch() {
    return (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
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
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateAndWait.mockResolvedValue(mockSwaDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockFetch.mockImplementation(makeDefaultFetch());
  });

  it("returns status:provisioned (not not_implemented)", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result.status).toBe("provisioned");
  });

  it("returns swa_hostname from deployment outputs", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result.swa_hostname).toBe("gentle-wave-abc.azurestaticapps.net");
  });

  it("returns deployment_token from deployment outputs", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result.deployment_token).toBe("swa-token-abc123");
  });

  it("returns swa_id from deployment outputs", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result.swa_id).toContain("staticSites");
  });

  it("creates resource group", async () => {
    await configureCloud(swaParams);
    expect(mockRGCreateOrUpdate).toHaveBeenCalledWith(
      "my-app-rg",
      expect.objectContaining({ location: "eastus2" })
    );
  });

  it("deploys static-web-app.json template with deployment name ${project_name}-swa-deploy", async () => {
    await configureCloud(swaParams);
    expect(mockCreateOrUpdateAndWait).toHaveBeenCalledTimes(1);
    expect(mockCreateOrUpdateAndWait).toHaveBeenCalledWith(
      "my-app-rg",
      "my-app-swa-deploy",
      expect.objectContaining({
        properties: expect.objectContaining({
          template: expect.objectContaining({
            "$schema": expect.stringContaining("deploymentTemplate.json"),
          }),
        }),
      })
    );
  });

  it("creates OIDC resources (app registrations, SPs, FICs) for all three environments", async () => {
    await configureCloud(swaParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const appPosts = calls.filter(
      ([url, opts]) =>
        String(url).includes("graph.microsoft.com/v1.0/applications") &&
        !String(url).includes("federatedIdentity") &&
        opts?.method === "POST"
    );
    expect(appPosts).toHaveLength(3);
  });

  it("creates OIDC federated credentials for all three environments", async () => {
    await configureCloud(swaParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const ficPosts = calls.filter(
      ([url, opts]) => String(url).includes("federatedIdentityCredentials") && opts?.method === "POST"
    );
    expect(ficPosts).toHaveLength(3);
  });

  it("returns oidc_client_ids for preview, staging, and production", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    const ids = result.oidc_client_ids as Record<string, string>;
    expect(ids.preview).toBe("client-id-mock");
    expect(ids.staging).toBe("client-id-mock");
    expect(ids.production).toBe("client-id-mock");
  });

  it("does NOT assign AcrPush role (no container registry in SWA path)", async () => {
    await configureCloud(swaParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string; body?: string }]>;
    const acrPushCalls = calls.filter(
      ([url, opts]) =>
        String(url).includes("roleAssignments") &&
        opts?.method === "PUT" &&
        // ACR_PUSH_ROLE_ID = "8311e382-0749-4cb8-b61a-304f252e45ec"
        JSON.stringify(opts?.body).includes("8311e382-0749-4cb8-b61a-304f252e45ec")
    );
    expect(acrPushCalls).toHaveLength(0);
  });

  it("only assigns Contributor roles (3 — one per environment) on the resource group", async () => {
    await configureCloud(swaParams);
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const roleCalls = calls.filter(
      ([url, opts]) => String(url).includes("roleAssignments") && opts?.method === "PUT"
    );
    expect(roleCalls).toHaveLength(3);
  });

  it("does NOT include acr_login_server or acr_id in the return value", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result).not.toHaveProperty("acr_login_server");
    expect(result).not.toHaveProperty("acr_id");
  });

  it("does NOT include staging_fqdn or production_fqdn in the return value", async () => {
    const result = await configureCloud(swaParams) as Record<string, unknown>;
    expect(result).not.toHaveProperty("staging_fqdn");
    expect(result).not.toHaveProperty("production_fqdn");
  });
});

describe("configureCloud — happy path (container-app)", () => {
  const validParams = {
    project_name: "my-app",
    github_repo: "owner/my-app",
    azure_subscription_id: "sub-123",
    azure_region: "eastus2",
  };

  function makeDefaultFetch() {
    return (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      // Idempotency lookups — empty by default so the create path runs
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
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
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateAndWait.mockResolvedValue(mockEnvDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockFetch.mockImplementation(makeDefaultFetch());
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

  // --- Idempotency tests ---

  it("reuses an existing app registration when uniqueName already exists (no duplicate POST)", async () => {
    // Simulate app already existing: GET returns it, no POST should be made
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("applications") && urlStr.includes("$filter") && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{ id: "existing-app-id", appId: "existing-client-id" }] }) });
      }
      if (method === "GET" && urlStr.includes("servicePrincipals") && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{ id: "existing-sp-id" }] }) });
      }
      if (method === "GET" && urlStr.includes("federatedIdentityCredentials") && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{}] }) });
      }
      if (urlStr.includes("roleAssignments") && method === "PUT") {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const result = await configureCloud(validParams) as Record<string, unknown>;
    expect(result.status).toBe("provisioned");

    // No POST to /applications should have been made (reused existing)
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const appPosts = calls.filter(
      ([url, opts]) =>
        String(url).includes("graph.microsoft.com/v1.0/applications") &&
        !String(url).includes("federatedIdentity") &&
        opts?.method === "POST"
    );
    expect(appPosts).toHaveLength(0);
  });

  it("skips federated credential creation when FIC with matching name already exists", async () => {
    // App and SP not found (will create), FIC already exists (should skip POST)
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("federatedIdentityCredentials") && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [{}] }) });
      }
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
      if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "app-object-id", appId: "client-id-mock" }) });
      }
      if (urlStr.includes("servicePrincipals") && method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "sp-object-id-mock" }) });
      }
      if (urlStr.includes("roleAssignments") && method === "PUT") {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    await configureCloud(validParams);

    // No POST to /federatedIdentityCredentials should have been made
    const calls = mockFetch.mock.calls as Array<[string, { method?: string }]>;
    const ficPosts = calls.filter(
      ([url, opts]) => String(url).includes("federatedIdentityCredentials") && opts?.method === "POST"
    );
    expect(ficPosts).toHaveLength(0);
  });
});

describe("configureCloud — error propagation", () => {
  const validParams = {
    project_name: "my-app",
    github_repo: "owner/my-app",
    azure_subscription_id: "sub-123",
  };

  function makeDefaultFetch() {
    return (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
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
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrUpdateAndWait.mockResolvedValue(mockEnvDeploymentResult);
    mockRGCreateOrUpdate.mockResolvedValue({});
    mockFetch.mockImplementation(makeDefaultFetch());
  });

  it("surfaces ARM deployment errors", async () => {
    mockCreateOrUpdateAndWait.mockRejectedValueOnce(new Error("ARM deployment failed"));
    await expect(configureCloud(validParams)).rejects.toThrow("ARM deployment failed");
  });

  it("surfaces Graph API lookup errors (GET) with a descriptive message", async () => {
    // The first Graph call is now a GET lookup — fail it to test error propagation
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("applications") && urlStr.includes("$filter") && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("Insufficient privileges") });
      }
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "x", appId: "y" }) });
    });
    await expect(configureCloud(validParams)).rejects.toThrow("Graph API: failed to look up app registration");
  });

  it("surfaces Graph API app creation errors with a descriptive message", async () => {
    // Lookup returns empty (not found), then create fails
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
      if (urlStr.includes("graph.microsoft.com/v1.0/applications") && method === "POST" && !urlStr.includes("federatedIdentity")) {
        return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("Insufficient privileges") });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    await expect(configureCloud(validParams)).rejects.toThrow("Graph API: failed to create app registration");
  });

  it("treats 409 Conflict on role assignments as success (idempotent re-run)", async () => {
    mockFetch.mockImplementation((url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      const urlStr = String(url);
      if (method === "GET" && urlStr.includes("$filter")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) });
      }
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
