import { describe, it, expect } from "vitest";
import { configureCloud } from "./configure-cloud.js";

describe("configureCloud — valid params", () => {
  it("returns status:not_implemented with required fields only", async () => {
    const result = await configureCloud({
      project_name: "my-app",
      github_repo: "owner/my-app",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("returns status:not_implemented with explicit adapter static-web-app", async () => {
    const result = await configureCloud({
      project_name: "my-app",
      github_repo: "owner/my-app",
      adapter: "static-web-app",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts an explicit azure_region", async () => {
    const result = await configureCloud({
      project_name: "my-app",
      github_repo: "owner/my-app",
      azure_region: "westus2",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });
});

describe("configureCloud — invalid params", () => {
  it("throws Invalid params when project_name is missing", async () => {
    await expect(
      configureCloud({ github_repo: "owner/my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      configureCloud({ project_name: "my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      configureCloud({ project_name: "my-app", github_repo: "notvalid" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when adapter is not a valid enum value", async () => {
    await expect(
      configureCloud({ project_name: "my-app", github_repo: "owner/my-app", adapter: "unknown" })
    ).rejects.toThrow("Invalid params:");
  });
});
