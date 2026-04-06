import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { handleAction } from "./handler.js";

// Mocked so the 500-path test can inject a non-validation error without
// calling real infrastructure. Vitest hoists vi.mock() above all imports.
vi.mock("./actions/bootstrap-framework.js", () => ({
  bootstrapFramework: vi.fn(),
}));

// Mocked so create_project dispatch tests never make real GitHub API calls.
vi.mock("./lib/github-client.js", () => ({
  getGithubClient: () => ({
    users: {
      getByUsername: vi.fn().mockResolvedValue({ data: { type: "User" } }),
      getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "acme" } }),
    },
    repos: {
      createForAuthenticatedUser: vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/acme/my-app", default_branch: "main" },
      }),
      createInOrg: vi.fn(),
    },
    git: {
      getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc" } } }),
      getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "tree-abc" } } }),
      createBlob: vi.fn().mockResolvedValue({ data: { sha: "blob" } }),
      createTree: vi.fn().mockResolvedValue({ data: { sha: "tree" } }),
      createCommit: vi.fn().mockResolvedValue({ data: { sha: "commit" } }),
      createRef: vi.fn().mockResolvedValue({}),
    },
    pulls: {
      create: vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/acme/my-app/pull/1", number: 1 },
      }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown): Request {
  return { body } as unknown as Request;
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  // res.json() and res.status().json() both need to work
  const res = {
    status,
    json,
  } as unknown as Response;
  return { res, status, json };
}

// ---------------------------------------------------------------------------
// Tests: request-level validation (before action dispatch)
// ---------------------------------------------------------------------------

describe("handleAction — request validation", () => {
  it("returns 400 when body is missing the action field", async () => {
    const req = makeReq({});
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when body is not an object", async () => {
    const req = makeReq("not-an-object");
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: action dispatch
// ---------------------------------------------------------------------------

describe("handleAction — unknown action", () => {
  it("returns 404 for an unrecognised action name", async () => {
    const req = makeReq({ action: "does_not_exist" });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: 500 error path — action throws a non-validation error
// ---------------------------------------------------------------------------

describe("handleAction — 500 error path", () => {
  it("returns 500 when an action throws an unexpected non-validation error", async () => {
    const { bootstrapFramework } = await import("./actions/bootstrap-framework.js");
    vi.mocked(bootstrapFramework).mockRejectedValueOnce(new Error("Unexpected DB failure"));

    const req = makeReq({ action: "bootstrap_framework" });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});

// ---------------------------------------------------------------------------
// Tests: dispatch coverage for all 8 actions (happy path via handler)
// ---------------------------------------------------------------------------

describe("handleAction — dispatch coverage", () => {
  it("routes bootstrap_framework → 200", async () => {
    const req = makeReq({ action: "bootstrap_framework" });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes create_project → 200 with valid params", async () => {
    const req = makeReq({
      action: "create_project",
      params: {
        name: "my-app",
        template: "nextjs",
        github_owner: "acme",
        approvers: ["alice"],
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes import_project → 200 with valid params", async () => {
    const req = makeReq({
      action: "import_project",
      params: {
        github_repo: "owner/existing-app",
        approvers: ["alice"],
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes configure_repo → 200 with valid params", async () => {
    const req = makeReq({
      action: "configure_repo",
      params: {
        github_repo: "owner/my-app",
        approvers: ["alice"],
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes configure_cloud → 200 with valid params", async () => {
    const req = makeReq({
      action: "configure_cloud",
      params: {
        project_name: "my-app",
        github_repo: "owner/my-app",
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes generate_assets → 200 with valid params", async () => {
    const req = makeReq({
      action: "generate_assets",
      params: {
        project_name: "my-app",
        github_repo: "owner/my-app",
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("routes post_status → 200 with valid params", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "owner/repo",
        pr_number: 1,
        status: "success",
        message: "Deployed",
      },
    });
    const { res, json } = makeRes();
    await handleAction(req, res);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  // capture_preview is excluded from dispatch happy-path tests — it launches a
  // real Playwright browser and requires chromium to be installed. Its param
  // validation is covered in capture-preview.test.ts.
});

// ---------------------------------------------------------------------------
// Tests: post_status action (real action with Zod param validation)
// ---------------------------------------------------------------------------

describe("handleAction — post_status", () => {
  it("returns 200 with ok:true when all required params are valid", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "owner/repo",
        pr_number: 1,
        status: "success",
        message: "Deploy succeeded",
      },
    });
    const { res, json } = makeRes();

    await handleAction(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
  });

  it("returns 200 and includes optional preview_url when supplied", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "owner/repo",
        pr_number: 7,
        status: "pending",
        message: "Deploying…",
        preview_url: "https://preview.example.com",
      },
    });
    const { res, json } = makeRes();

    await handleAction(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
  });

  it("returns 400 when required params are missing", async () => {
    const req = makeReq({
      action: "post_status",
      params: { github_repo: "owner/repo" }, // missing pr_number, status, message
    });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when pr_number is not a positive integer", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "owner/repo",
        pr_number: -1,
        status: "success",
        message: "ok",
      },
    });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when status is not an allowed enum value", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "owner/repo",
        pr_number: 1,
        status: "unknown_value",
        message: "ok",
      },
    });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when github_repo is not in owner/repo format", async () => {
    const req = makeReq({
      action: "post_status",
      params: {
        github_repo: "not-valid",
        pr_number: 1,
        status: "success",
        message: "ok",
      },
    });
    const { res, status } = makeRes();

    await handleAction(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });
});
