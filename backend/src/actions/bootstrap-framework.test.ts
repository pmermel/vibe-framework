import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above all imports by Vitest
// ---------------------------------------------------------------------------

// Mock the GitHub client so we don't need real credentials.
const mockGetAuthenticated = vi.fn();
const mockGetEnvironment = vi.fn();

vi.mock("../lib/github-client.js", () => ({
  getGithubClient: vi.fn(() => ({
    apps: { getAuthenticated: mockGetAuthenticated },
    repos: { getEnvironment: mockGetEnvironment },
  })),
}));

// Mock global fetch for backend health checks.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { bootstrapFramework } from "./bootstrap-framework.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHealthResponse(status = "ok", httpStatus = 200) {
  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    json: () => Promise.resolve({ status }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: GitHub App auth succeeds
  mockGetAuthenticated.mockResolvedValue({});
  // Default: all three environments exist
  mockGetEnvironment.mockResolvedValue({});
  // Default: backend health returns ok
  mockFetch.mockResolvedValue(makeHealthResponse("ok", 200));
});

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

describe("bootstrapFramework — param validation", () => {
  it("throws Invalid params when called with no params", async () => {
    await expect(bootstrapFramework({})).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      bootstrapFramework({ backend_url: "https://example.com" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when backend_url is missing", async () => {
    await expect(
      bootstrapFramework({ github_repo: "owner/repo" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo lacks a slash", async () => {
    await expect(
      bootstrapFramework({ github_repo: "notavalidrepo", backend_url: "https://example.com" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when backend_url is not a valid URL", async () => {
    await expect(
      bootstrapFramework({ github_repo: "owner/repo", backend_url: "not-a-url" })
    ).rejects.toThrow("Invalid params:");
  });
});

// ---------------------------------------------------------------------------
// Happy path — all checks pass
// ---------------------------------------------------------------------------

describe("bootstrapFramework — all checks pass", () => {
  it("returns status:ok when all three checks succeed", async () => {
    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("ok");
    expect(result.checks.github_app).toBe(true);
    expect(result.checks.backend_health).toBe(true);
    expect(result.checks.environments).toBe(true);
    expect(result.details).toHaveLength(3);
  });

  it("calls getAuthenticated to verify GitHub App auth", async () => {
    await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });
    expect(mockGetAuthenticated).toHaveBeenCalledOnce();
  });

  it("fetches /health on the backend_url to verify reachability", async () => {
    await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://backend.example.com/health",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("checks all three GitHub environments: preview, staging, production", async () => {
    await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });
    expect(mockGetEnvironment).toHaveBeenCalledTimes(3);
    expect(mockGetEnvironment).toHaveBeenCalledWith({ owner: "owner", repo: "repo", environment_name: "preview" });
    expect(mockGetEnvironment).toHaveBeenCalledWith({ owner: "owner", repo: "repo", environment_name: "staging" });
    expect(mockGetEnvironment).toHaveBeenCalledWith({ owner: "owner", repo: "repo", environment_name: "production" });
  });

  it("strips a trailing slash from backend_url before building health URL", async () => {
    await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com/",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://backend.example.com/health",
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Degraded — GitHub App auth fails
// ---------------------------------------------------------------------------

describe("bootstrapFramework — GitHub App auth degraded", () => {
  it("returns status:degraded when GitHub App auth throws", async () => {
    mockGetAuthenticated.mockRejectedValueOnce(new Error("Bad credentials"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.github_app).toBe(false);
    // The other checks should still have run
    expect(result.checks.backend_health).toBe(true);
    expect(result.checks.environments).toBe(true);
  });

  it("includes the error message in details", async () => {
    mockGetAuthenticated.mockRejectedValueOnce(new Error("Bad credentials"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.details.some((d) => d.includes("Bad credentials"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Degraded — backend health fails
// ---------------------------------------------------------------------------

describe("bootstrapFramework — backend health degraded", () => {
  it("returns status:degraded when health endpoint returns non-200", async () => {
    mockFetch.mockResolvedValueOnce(makeHealthResponse("ok", 503));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.backend_health).toBe(false);
  });

  it("returns status:degraded when health body has unexpected status field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: "error" }),
    });

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.backend_health).toBe(false);
  });

  it("returns status:degraded when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.backend_health).toBe(false);
    expect(result.details.some((d) => d.includes("ECONNREFUSED"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Degraded — GitHub environments missing
// ---------------------------------------------------------------------------

describe("bootstrapFramework — environments degraded", () => {
  it("returns status:degraded when one environment is missing", async () => {
    // Only fail for 'production'
    mockGetEnvironment.mockImplementation(
      ({ environment_name }: { environment_name: string }) => {
        if (environment_name === "production") {
          return Promise.reject(new Error("Not Found"));
        }
        return Promise.resolve({});
      }
    );

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.environments).toBe(false);
    expect(result.details.some((d) => d.includes("production"))).toBe(true);
  });

  it("returns status:degraded when all environments are missing", async () => {
    mockGetEnvironment.mockRejectedValue(new Error("Not Found"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.environments).toBe(false);
  });

  it("lists all missing environments in the details", async () => {
    mockGetEnvironment.mockRejectedValue(new Error("Not Found"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    const envDetail = result.details.find((d) => d.startsWith("GitHub environments:"));
    expect(envDetail).toContain("preview");
    expect(envDetail).toContain("staging");
    expect(envDetail).toContain("production");
  });
});

// ---------------------------------------------------------------------------
// Degraded — multiple checks fail
// ---------------------------------------------------------------------------

describe("bootstrapFramework — multiple checks degraded", () => {
  it("returns status:degraded when all checks fail", async () => {
    mockGetAuthenticated.mockRejectedValue(new Error("auth fail"));
    mockFetch.mockRejectedValue(new Error("network fail"));
    mockGetEnvironment.mockRejectedValue(new Error("not found"));

    const result = await bootstrapFramework({
      github_repo: "owner/repo",
      backend_url: "https://backend.example.com",
    });

    expect(result.status).toBe("degraded");
    expect(result.checks.github_app).toBe(false);
    expect(result.checks.backend_health).toBe(false);
    expect(result.checks.environments).toBe(false);
    expect(result.details).toHaveLength(3);
  });
});
