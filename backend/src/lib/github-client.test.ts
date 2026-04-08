import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @octokit/auth-app before importing the module under test
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn().mockReturnValue(async () => ({ type: "installation", token: "ghs_test" })),
}));

// Mock @octokit/rest so we can inspect constructor args without real API calls
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation((opts) => ({ _opts: opts })),
}));

describe("getGithubClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses GitHub App auth when all three App env vars are set", async () => {
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----";
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";
    delete process.env.GITHUB_TOKEN;

    const { getGithubClient } = await import("./github-client.js");
    const { Octokit } = await import("@octokit/rest");
    const { createAppAuth } = await import("@octokit/auth-app");

    getGithubClient();

    expect(Octokit).toHaveBeenCalledWith(
      expect.objectContaining({
        authStrategy: createAppAuth,
        auth: expect.objectContaining({
          appId: 42,
          installationId: 1001,
        }),
      })
    );
  });

  it("normalises escaped \\n in GITHUB_APP_PRIVATE_KEY", async () => {
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY = "line1\\nline2\\nline3";
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";
    delete process.env.GITHUB_TOKEN;

    const { getGithubClient } = await import("./github-client.js");
    const { Octokit } = await import("@octokit/rest");

    getGithubClient();

    const call = vi.mocked(Octokit).mock.calls[0][0] as { auth: { privateKey: string } };
    expect(call.auth.privateKey).toBe("line1\nline2\nline3");
  });

  it("falls back to PAT auth when GITHUB_TOKEN is set and App vars are absent", async () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    process.env.GITHUB_TOKEN = "ghp_test_token";

    const { getGithubClient } = await import("./github-client.js");
    const { Octokit } = await import("@octokit/rest");

    getGithubClient();

    expect(Octokit).toHaveBeenCalledWith({ auth: "ghp_test_token" });
  });

  it("prefers GitHub App auth over GITHUB_TOKEN when both are set", async () => {
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY = "pem";
    process.env.GITHUB_APP_INSTALLATION_ID = "1001";
    process.env.GITHUB_TOKEN = "ghp_should_not_be_used";

    const { getGithubClient } = await import("./github-client.js");
    const { Octokit } = await import("@octokit/rest");
    const { createAppAuth } = await import("@octokit/auth-app");

    getGithubClient();

    expect(Octokit).toHaveBeenCalledWith(
      expect.objectContaining({ authStrategy: createAppAuth })
    );
  });

  it("throws a clear error when no auth is configured", async () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_TOKEN;

    const { getGithubClient } = await import("./github-client.js");

    expect(() => getGithubClient()).toThrow(
      "GitHub authentication is not configured"
    );
  });

  it("throws mentioning production and development config in error message", async () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_TOKEN;

    const { getGithubClient } = await import("./github-client.js");

    expect(() => getGithubClient()).toThrow(/GITHUB_APP_ID.*GITHUB_APP_PRIVATE_KEY.*GITHUB_APP_INSTALLATION_ID/);
  });
});
