import { describe, it, expect } from "vitest";
import { createProject } from "./create-project.js";

describe("createProject — valid params", () => {
  it("returns status:not_implemented with all required fields", async () => {
    const result = await createProject({
      name: "my-app",
      template: "nextjs",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts explicit adapter and azure_region", async () => {
    const result = await createProject({
      name: "my-app",
      template: "react-vite",
      github_owner: "acme",
      approvers: ["alice"],
      adapter: "static-web-app",
      azure_region: "westus2",
    });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("accepts node-api template", async () => {
    const result = await createProject({
      name: "my-api",
      template: "node-api",
      github_owner: "acme",
      approvers: ["alice"],
    });
    expect(result).toEqual({ status: "not_implemented" });
  });
});

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
