import { describe, it, expect } from "vitest";
import { generateAssets } from "./generate-assets.js";

describe("generateAssets — valid params", () => {
  it("returns status:not_implemented with required fields only (uses default asset_types)", async () => {
    const result = await generateAssets({
      project_name: "my-app",
      github_repo: "owner/my-app",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts explicit asset_types array", async () => {
    const result = await generateAssets({
      project_name: "my-app",
      github_repo: "owner/my-app",
      asset_types: ["icon", "favicon", "og-image"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts all valid asset type values", async () => {
    const result = await generateAssets({
      project_name: "my-app",
      github_repo: "owner/my-app",
      asset_types: ["icon", "favicon", "og-image", "placeholder-marketing", "screenshot"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });
});

describe("generateAssets — invalid params", () => {
  it("throws Invalid params when project_name is missing", async () => {
    await expect(
      generateAssets({ github_repo: "owner/my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      generateAssets({ project_name: "my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      generateAssets({ project_name: "my-app", github_repo: "notvalid" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when asset_types contains an invalid value", async () => {
    await expect(
      generateAssets({
        project_name: "my-app",
        github_repo: "owner/my-app",
        asset_types: ["favicon", "video"],
      })
    ).rejects.toThrow("Invalid params:");
  });
});
