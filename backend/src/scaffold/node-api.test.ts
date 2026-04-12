import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { generateNodeApiScaffold } from "./node-api.js";

const BASE_PARAMS = {
  name: "my-api",
  github_owner: "acme",
  azure_region: "eastus2",
  adapter: "container-app" as const,
  approvers: ["alice"],
  framework_repo: "pmermel/vibe-framework",
};

function scaffold(overrides: Partial<typeof BASE_PARAMS> = {}) {
  return generateNodeApiScaffold({ ...BASE_PARAMS, ...overrides });
}

describe("generateNodeApiScaffold — file map keys", () => {
  it("contains exactly the expected file keys", () => {
    const files = scaffold();
    const keys = Object.keys(files).sort();

    const expected = [
      ".ai/context/AZURE_TARGETS.md",
      ".ai/context/STACK_DECISIONS.md",
      ".devcontainer/devcontainer.json",
      ".gitignore",
      ".github/workflows/preview-ttl-cleanup.yml",
      ".github/workflows/preview.yml",
      ".github/workflows/production.yml",
      ".github/workflows/staging.yml",
      "AGENTS.md",
      "CLAUDE.md",
      "Dockerfile",
      "README.md",
      "package.json",
      "src/__tests__/app.test.ts",
      "src/index.ts",
      "tsconfig.json",
      "vibe.yaml",
    ].sort();

    expect(keys).toEqual(expected);
  });
});

describe("generateNodeApiScaffold — vibe.yaml", () => {
  it("parses as valid YAML", () => {
    const files = scaffold();
    expect(() => yaml.load(files["vibe.yaml"])).not.toThrow();
  });

  it("sets template: node-api and adapter: container-app", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    expect(parsed["template"]).toBe("node-api");
    expect(parsed["adapter"]).toBe("container-app");
  });

  it("writes the correct github.repo field", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github["repo"]).toBe("acme/my-api");
  });

  it("uses npm install (not npm ci) so CI works without a committed lockfile", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const build = parsed["build"] as Record<string, unknown>;
    expect(build["install"]).toBe("npm install");
  });
});

describe("generateNodeApiScaffold — package.json", () => {
  it("parses as valid JSON", () => {
    expect(() => JSON.parse(scaffold()["package.json"])).not.toThrow();
  });

  it("includes express and the expected scripts", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.dependencies).toHaveProperty("express");
    expect(pkg.scripts.dev).toBe("tsx watch src/index.ts");
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.json");
    expect(pkg.scripts.test).toBe("vitest run");
  });
});

describe("generateNodeApiScaffold — Dockerfile", () => {
  it("targets a Node runtime and the dist output", () => {
    const dockerfile = scaffold()["Dockerfile"];
    expect(dockerfile).toContain("FROM node:20-alpine");
    expect(dockerfile).toContain("COPY --from=builder /app/dist ./dist");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
  });

  it("uses npm install (not npm ci) so the image builds without a lockfile", () => {
    const dockerfile = scaffold()["Dockerfile"];
    expect(dockerfile).toContain("RUN npm install");
    expect(dockerfile).not.toContain("RUN npm ci");
  });
});

describe("generateNodeApiScaffold — app files", () => {
  it("creates an Express starter listening on port 8080", () => {
    const indexTs = scaffold()["src/index.ts"];
    expect(indexTs).toContain('import express from "express"');
    expect(indexTs).toContain('process.env.PORT ?? 8080');
    expect(indexTs).toContain('app.get("/health"');
  });

  it("sets preview target_port to 8080 in the wrapper workflow", () => {
    const previewWorkflow = scaffold()[".github/workflows/preview.yml"];
    expect(previewWorkflow).toContain("target_port: 8080");
    expect(previewWorkflow).toContain("vars.VIBE_BACKEND_URL");
  });
});
