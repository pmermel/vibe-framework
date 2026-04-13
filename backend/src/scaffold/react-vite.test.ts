import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { generateReactViteScaffold } from "./react-vite.js";

const BASE_PARAMS = {
  name: "my-site",
  github_owner: "acme",
  azure_region: "eastus2",
  adapter: "static-web-app" as const,
  approvers: ["alice"],
  framework_repo: "pmermel/vibe-framework",
};

function scaffold(overrides: Partial<typeof BASE_PARAMS> = {}) {
  return generateReactViteScaffold({ ...BASE_PARAMS, ...overrides });
}

describe("generateReactViteScaffold — file map keys", () => {
  it("contains exactly the expected file keys", () => {
    const files = scaffold();
    const keys = Object.keys(files).sort();

    const expected = [
      ".ai/context/AZURE_TARGETS.md",
      ".ai/context/STACK_DECISIONS.md",
      ".devcontainer/devcontainer.json",
      ".gitignore",
      ".github/workflows/preview.yml",
      ".github/workflows/production.yml",
      ".github/workflows/staging.yml",
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "index.html",
      "package.json",
      "src/__tests__/App.test.ts",
      "src/App.tsx",
      "src/index.css",
      "src/main.tsx",
      "tsconfig.json",
      "vibe.yaml",
      "vite.config.ts",
    ].sort();

    expect(keys).toEqual(expected);
  });

  it("does NOT include Dockerfile (SWA deploys static assets, no container)", () => {
    const files = scaffold();
    expect(Object.keys(files)).not.toContain("Dockerfile");
  });

  it("does NOT include preview-ttl-cleanup workflow (SWA handles preview cleanup automatically)", () => {
    const files = scaffold();
    expect(Object.keys(files)).not.toContain(".github/workflows/preview-ttl-cleanup.yml");
  });
});

describe("generateReactViteScaffold — vibe.yaml", () => {
  it("parses as valid YAML", () => {
    const files = scaffold();
    expect(() => yaml.load(files["vibe.yaml"])).not.toThrow();
  });

  it("sets template: react-vite and adapter: static-web-app", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    expect(parsed["template"]).toBe("react-vite");
    expect(parsed["adapter"]).toBe("static-web-app");
  });

  it("uses npm install (not npm ci) in build.install", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const build = parsed["build"] as Record<string, unknown>;
    expect(build["install"]).toBe("npm install");
  });

  it("sets build.output to dist", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const build = parsed["build"] as Record<string, unknown>;
    expect(build["output"]).toBe("dist");
  });

  it("sets all deploy targets to static-web-app", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const deploy = parsed["deploy"] as Record<string, Record<string, string>>;
    expect(deploy["preview"]["target"]).toBe("static-web-app");
    expect(deploy["staging"]["target"]).toBe("static-web-app");
    expect(deploy["production"]["target"]).toBe("static-web-app");
  });

  it("writes the correct github.repo field", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github["repo"]).toBe("acme/my-site");
  });

  it("does NOT include registry or container_app_environment in azure section", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const azure = parsed["azure"] as Record<string, unknown>;
    expect(azure).not.toHaveProperty("registry");
    expect(azure).not.toHaveProperty("container_app_environment");
    expect(azure).not.toHaveProperty("preview_app_prefix");
    expect(azure).not.toHaveProperty("staging_app");
    expect(azure).not.toHaveProperty("production_app");
  });

  it("includes static_web_app in azure section", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const azure = parsed["azure"] as Record<string, unknown>;
    expect(azure).toHaveProperty("static_web_app", "my-site-swa");
  });
});

describe("generateReactViteScaffold — package.json", () => {
  it("parses as valid JSON", () => {
    expect(() => JSON.parse(scaffold()["package.json"])).not.toThrow();
  });

  it("has react and react-dom dependencies", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.dependencies).toHaveProperty("react");
    expect(pkg.dependencies).toHaveProperty("react-dom");
  });

  it("has vite and @vitejs/plugin-react devDependencies", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.devDependencies).toHaveProperty("vite");
    expect(pkg.devDependencies).toHaveProperty("@vitejs/plugin-react");
  });

  it("has scripts.dev = 'vite'", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.scripts.dev).toBe("vite");
  });

  it("has scripts.build = 'vite build'", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.scripts.build).toBe("vite build");
  });

  it("has scripts.test = 'vitest run'", () => {
    const pkg = JSON.parse(scaffold()["package.json"]);
    expect(pkg.scripts.test).toBe("vitest run");
  });
});

describe("generateReactViteScaffold — index.html", () => {
  it("contains <div id='root'>", () => {
    const html = scaffold()["index.html"];
    expect(html).toContain('<div id="root">');
  });

  it("contains <script type='module' src='/src/main.tsx'>", () => {
    const html = scaffold()["index.html"];
    expect(html).toContain('src="/src/main.tsx"');
  });
});

describe("generateReactViteScaffold — preview wrapper workflow", () => {
  it("calls reusable-swa-preview.yml@v1 via uses", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("reusable-swa-preview.yml@v1");
  });

  it("uses secrets: inherit (not stored AZURE_STATIC_WEB_APPS_API_TOKEN)", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("secrets: inherit");
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });

  it("passes swa_name: my-site-swa", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("swa_name: my-site-swa");
  });

  it("passes install_command: npm install", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("install_command: npm install");
  });

  it("triggers on pull_request types including closed", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("closed");
  });

  it("passes backend_url: ${{ vars.VIBE_BACKEND_URL }} for enrichment", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).toContain("backend_url:");
    expect(workflow).toContain("VIBE_BACKEND_URL");
  });
});

describe("generateReactViteScaffold — staging wrapper workflow", () => {
  it("calls reusable-swa-staging.yml@v1 via uses", () => {
    const workflow = scaffold()[".github/workflows/staging.yml"];
    expect(workflow).toContain("reusable-swa-staging.yml@v1");
  });

  it("uses secrets: inherit (not stored AZURE_STATIC_WEB_APPS_API_TOKEN)", () => {
    const workflow = scaffold()[".github/workflows/staging.yml"];
    expect(workflow).toContain("secrets: inherit");
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });

  it("passes swa_name: my-site-swa", () => {
    const workflow = scaffold()[".github/workflows/staging.yml"];
    expect(workflow).toContain("swa_name: my-site-swa");
  });

  it("triggers on push to develop", () => {
    const workflow = scaffold()[".github/workflows/staging.yml"];
    expect(workflow).toContain("develop");
  });
});

describe("generateReactViteScaffold — production wrapper workflow", () => {
  it("calls reusable-swa-production.yml@v1 via uses", () => {
    const workflow = scaffold()[".github/workflows/production.yml"];
    expect(workflow).toContain("reusable-swa-production.yml@v1");
  });

  it("uses secrets: inherit (not stored AZURE_STATIC_WEB_APPS_API_TOKEN)", () => {
    const workflow = scaffold()[".github/workflows/production.yml"];
    expect(workflow).toContain("secrets: inherit");
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });

  it("passes swa_name: my-site-swa", () => {
    const workflow = scaffold()[".github/workflows/production.yml"];
    expect(workflow).toContain("swa_name: my-site-swa");
  });

  it("triggers on push to main", () => {
    const workflow = scaffold()[".github/workflows/production.yml"];
    expect(workflow).toContain("main");
  });
});

describe("generateReactViteScaffold — no stored deployment token", () => {
  it("preview wrapper does not contain AZURE_STATIC_WEB_APPS_API_TOKEN", () => {
    const workflow = scaffold()[".github/workflows/preview.yml"];
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });

  it("staging wrapper does not contain AZURE_STATIC_WEB_APPS_API_TOKEN", () => {
    const workflow = scaffold()[".github/workflows/staging.yml"];
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });

  it("production wrapper does not contain AZURE_STATIC_WEB_APPS_API_TOKEN", () => {
    const workflow = scaffold()[".github/workflows/production.yml"];
    expect(workflow).not.toContain("AZURE_STATIC_WEB_APPS_API_TOKEN");
  });
});

describe("generateReactViteScaffold — vibe.yaml workflow_refs", () => {
  it("contains github.workflow_refs section", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    expect(github).toHaveProperty("workflow_refs");
  });

  it("workflow_refs.preview points to reusable-swa-preview.yml@v1", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    const refs = github["workflow_refs"] as Record<string, string>;
    expect(refs["preview"]).toContain("reusable-swa-preview.yml@v1");
  });

  it("workflow_refs.staging points to reusable-swa-staging.yml@v1", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    const refs = github["workflow_refs"] as Record<string, string>;
    expect(refs["staging"]).toContain("reusable-swa-staging.yml@v1");
  });

  it("workflow_refs.production points to reusable-swa-production.yml@v1", () => {
    const parsed = yaml.load(scaffold()["vibe.yaml"]) as Record<string, unknown>;
    const github = parsed["github"] as Record<string, unknown>;
    const refs = github["workflow_refs"] as Record<string, string>;
    expect(refs["production"]).toContain("reusable-swa-production.yml@v1");
  });
});
