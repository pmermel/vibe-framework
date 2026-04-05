import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { handleAction } from "./handler.js";

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
