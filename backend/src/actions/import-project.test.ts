import { describe, it, expect } from "vitest";
import { importProject } from "./import-project.js";

describe("importProject — valid params", () => {
  it("returns status:not_implemented with required fields", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts explicit adapter and azure_region", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice"],
      adapter: "static-web-app",
      azure_region: "westus2",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts multiple approvers", async () => {
    const result = await importProject({
      github_repo: "owner/existing-app",
      approvers: ["alice", "bob"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });
});

describe("importProject — invalid params", () => {
  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      importProject({ approvers: ["alice"] })
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

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      importProject({ github_repo: "notvalid", approvers: ["alice"] })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when adapter is not a valid enum value", async () => {
    await expect(
      importProject({
        github_repo: "owner/existing-app",
        approvers: ["alice"],
        adapter: "unknown",
      })
    ).rejects.toThrow("Invalid params:");
  });
});
