import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { generateNextjsScaffold } from "./nextjs.js";

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------

const BASE_PARAMS = {
  name: "my-app",
  github_owner: "acme",
  azure_region: "eastus2",
  adapter: "container-app" as const,
  approvers: ["alice"],
  framework_repo: "pmermel/vibe-framework",
};

function scaffold(overrides: Partial<typeof BASE_PARAMS> = {}) {
  return generateNextjsScaffold({ ...BASE_PARAMS, ...overrides });
}

// ---------------------------------------------------------------------------
// File map structure
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — file map keys", () => {
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
      "next.config.ts",
      "package.json",
      "src/__tests__/app.test.ts",
      "src/app/globals.css",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "tsconfig.json",
      "vibe.yaml",
    ].sort();

    expect(keys).toEqual(expected);
  });

  it("returns string values for all keys", () => {
    const files = scaffold();
    for (const [key, value] of Object.entries(files)) {
      expect(typeof value, `${key} should be a string`).toBe("string");
      expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// vibe.yaml
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — vibe.yaml", () => {
  it("parses as valid YAML", () => {
    const files = scaffold();
    expect(() => yaml.load(files["vibe.yaml"])).not.toThrow();
  });

  it("has name field matching project name", () => {
    const files = scaffold();
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    expect(parsed["name"]).toBe("my-app");
  });

  it("has adapter: container-app", () => {
    const files = scaffold();
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    expect(parsed["adapter"]).toBe("container-app");
  });

  it("has correct github.repo format (owner/name)", () => {
    const files = scaffold();
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github["repo"]).toBe("acme/my-app");
  });

  it("has workflow_refs entries for all four workflows", () => {
    const files = scaffold();
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    const refs = github["workflow_refs"] as Record<string, unknown>;
    expect(refs).toHaveProperty("preview");
    expect(refs).toHaveProperty("staging");
    expect(refs).toHaveProperty("production");
    expect(refs).toHaveProperty("preview_ttl_cleanup");
  });

  it("workflow_refs point to the framework repo", () => {
    const files = scaffold({ framework_repo: "myorg/vibe-framework" });
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    const refs = github["workflow_refs"] as Record<string, string>;
    for (const [key, value] of Object.entries(refs)) {
      expect(value, `workflow_ref.${key} should reference the framework repo`).toContain(
        "myorg/vibe-framework"
      );
    }
  });

  it("reflects github_owner in github.repo", () => {
    const files = scaffold({ github_owner: "other-org", name: "other-app" });
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github["repo"]).toBe("other-org/other-app");
  });
});

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — package.json", () => {
  it("parses as valid JSON", () => {
    const files = scaffold();
    expect(() => JSON.parse(files["package.json"])).not.toThrow();
  });

  it("has name field matching project name", () => {
    const files = scaffold();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.name).toBe("my-app");
  });

  it("has scripts field", () => {
    const files = scaffold();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg).toHaveProperty("scripts");
    expect(typeof pkg.scripts).toBe("object");
  });

  it('has test script set to "vitest run"', () => {
    const files = scaffold();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("has dependencies containing next", () => {
    const files = scaffold();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg).toHaveProperty("dependencies");
    expect(pkg.dependencies).toHaveProperty("next");
  });

  it("has vitest in devDependencies", () => {
    const files = scaffold();
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg).toHaveProperty("devDependencies");
    expect(pkg.devDependencies).toHaveProperty("vitest");
  });

  it("name reflects varied project names", () => {
    const files = scaffold({ name: "totally-different-project" });
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg.name).toBe("totally-different-project");
  });
});

// ---------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — Dockerfile", () => {
  it("contains FROM node:", () => {
    const files = scaffold();
    expect(files["Dockerfile"]).toContain("FROM node:");
  });

  it("contains COPY instruction", () => {
    const files = scaffold();
    expect(files["Dockerfile"]).toContain("COPY");
  });

  it("contains CMD instruction", () => {
    const files = scaffold();
    expect(files["Dockerfile"]).toContain("CMD");
  });
});

// ---------------------------------------------------------------------------
// GitHub workflow wrappers
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — .github/workflows/preview.yml", () => {
  it("contains uses: pointing to framework workflow ref", () => {
    const files = scaffold();
    expect(files[".github/workflows/preview.yml"]).toContain("uses:");
    expect(files[".github/workflows/preview.yml"]).toContain("pmermel/vibe-framework");
  });

  it("uses: reference includes the correct workflow file", () => {
    const files = scaffold();
    expect(files[".github/workflows/preview.yml"]).toContain("reusable-preview.yml");
  });

  it("passes backend_url from vars.VIBE_BACKEND_URL", () => {
    const files = scaffold();
    expect(files[".github/workflows/preview.yml"]).toContain("backend_url:");
    expect(files[".github/workflows/preview.yml"]).toContain("vars.VIBE_BACKEND_URL");
  });

  it("backend_url input is present for different framework repos", () => {
    const files = scaffold({ framework_repo: "fork-org/vibe-framework" });
    expect(files[".github/workflows/preview.yml"]).toContain("backend_url:");
    expect(files[".github/workflows/preview.yml"]).toContain("vars.VIBE_BACKEND_URL");
  });
});

describe("generateNextjsScaffold — .github/workflows/staging.yml", () => {
  it("contains on: trigger block", () => {
    const files = scaffold();
    expect(files[".github/workflows/staging.yml"]).toContain("on:");
  });

  it("contains push: trigger", () => {
    const files = scaffold();
    expect(files[".github/workflows/staging.yml"]).toContain("push:");
  });

  it("triggers on the develop branch", () => {
    const files = scaffold();
    expect(files[".github/workflows/staging.yml"]).toContain("develop");
  });
});

// ---------------------------------------------------------------------------
// Agent instruction files
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — CLAUDE.md and AGENTS.md", () => {
  it("CLAUDE.md is a non-empty string containing the project name", () => {
    const files = scaffold();
    expect(files["CLAUDE.md"]).toBeTruthy();
    expect(files["CLAUDE.md"]).toContain("my-app");
  });

  it("AGENTS.md is a non-empty string containing the project name", () => {
    const files = scaffold();
    expect(files["AGENTS.md"]).toBeTruthy();
    expect(files["AGENTS.md"]).toContain("my-app");
  });

  it("CLAUDE.md reflects varied project name", () => {
    const files = scaffold({ name: "other-project" });
    expect(files["CLAUDE.md"]).toContain("other-project");
  });
});

// ---------------------------------------------------------------------------
// .devcontainer/devcontainer.json
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — .devcontainer/devcontainer.json", () => {
  it("parses as valid JSON", () => {
    const files = scaffold();
    expect(() => JSON.parse(files[".devcontainer/devcontainer.json"])).not.toThrow();
  });

  it("has a name field", () => {
    const files = scaffold();
    const config = JSON.parse(files[".devcontainer/devcontainer.json"]);
    expect(config).toHaveProperty("name");
  });
});

// ---------------------------------------------------------------------------
// tsconfig.json
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — tsconfig.json", () => {
  it("parses as valid JSON", () => {
    const files = scaffold();
    expect(() => JSON.parse(files["tsconfig.json"])).not.toThrow();
  });

  it("has compilerOptions", () => {
    const files = scaffold();
    const tsconfig = JSON.parse(files["tsconfig.json"]);
    expect(tsconfig).toHaveProperty("compilerOptions");
  });
});

// ---------------------------------------------------------------------------
// next.config.ts
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — next.config.ts", () => {
  it("contains standalone output setting", () => {
    const files = scaffold();
    expect(files["next.config.ts"]).toContain("standalone");
  });
});

// ---------------------------------------------------------------------------
// src/__tests__/app.test.ts placeholder
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — src/__tests__/app.test.ts", () => {
  it("is a non-empty string", () => {
    const files = scaffold();
    expect(files["src/__tests__/app.test.ts"]).toBeTruthy();
    expect(files["src/__tests__/app.test.ts"].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Varied inputs
// ---------------------------------------------------------------------------

describe("generateNextjsScaffold — varied inputs", () => {
  it("uses different project name throughout", () => {
    const files = scaffold({ name: "cool-saas" });
    const pkg = JSON.parse(files["package.json"]);
    const vibeYamlParsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    expect(pkg.name).toBe("cool-saas");
    expect(vibeYamlParsed["name"]).toBe("cool-saas");
    expect(files["CLAUDE.md"]).toContain("cool-saas");
  });

  it("uses different org name in vibe.yaml github.repo", () => {
    const files = scaffold({ github_owner: "big-corp", name: "enterprise-app" });
    const parsed = yaml.load(files["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github["repo"]).toBe("big-corp/enterprise-app");
  });

  it("uses different framework_repo in workflow wrappers", () => {
    const files = scaffold({ framework_repo: "fork-org/vibe-framework" });
    expect(files[".github/workflows/preview.yml"]).toContain("fork-org/vibe-framework");
    expect(files[".github/workflows/staging.yml"]).toContain("fork-org/vibe-framework");
    expect(files[".github/workflows/production.yml"]).toContain("fork-org/vibe-framework");
  });

  it("handles hyphenated project names without crashing", () => {
    const files = scaffold({ name: "my-super-long-project-name" });
    expect(() => JSON.parse(files["package.json"])).not.toThrow();
    expect(() => yaml.load(files["vibe.yaml"])).not.toThrow();
  });
});
