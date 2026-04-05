import { describe, it, expect } from "vitest";
import { configureRepo } from "./configure-repo.js";

describe("configureRepo — valid params", () => {
  it("returns status:not_implemented with required fields", async () => {
    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts custom staging and production branch names", async () => {
    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice", "bob"],
      staging_branch: "staging",
      production_branch: "production",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts multiple approvers", async () => {
    const result = await configureRepo({
      github_repo: "owner/my-app",
      approvers: ["alice", "bob", "carol"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });
});

describe("configureRepo — invalid params", () => {
  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      configureRepo({ approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is missing", async () => {
    await expect(
      configureRepo({ github_repo: "owner/my-app" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when approvers is empty", async () => {
    await expect(
      configureRepo({ github_repo: "owner/my-app", approvers: [] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      configureRepo({ github_repo: "notvalid", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });
});
