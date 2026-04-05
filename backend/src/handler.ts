import type { Request, Response } from "express";
import { z } from "zod";
import { bootstrapFramework } from "./actions/bootstrap-framework.js";
import { createProject } from "./actions/create-project.js";
import { importProject } from "./actions/import-project.js";
import { configureRepo } from "./actions/configure-repo.js";
import { configureCloud } from "./actions/configure-cloud.js";
import { generateAssets } from "./actions/generate-assets.js";
import { capturePreview } from "./actions/capture-preview.js";
import { postStatus } from "./actions/post-status.js";

const ActionRequest = z.object({
  action: z.string(),
  params: z.record(z.unknown()).optional().default({}),
});

const actions: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  bootstrap_framework: bootstrapFramework,
  create_project: createProject,
  import_project: importProject,
  configure_repo: configureRepo,
  configure_cloud: configureCloud,
  generate_assets: generateAssets,
  capture_preview: capturePreview,
  post_status: postStatus,
};

/**
 * handleAction
 *
 * Dispatches a POST /action request to the matching action handler.
 * Validates the top-level request shape (requires `action` string, optional `params`
 * object) and returns structured JSON for all outcomes.
 *
 * Does NOT validate action-specific params — each action owns its own Zod schema
 * and throws `"Invalid params: ..."` on failure, which this function catches and
 * converts to a 400 response.
 *
 * Response shapes:
 * - 400: malformed request body or action param validation failure
 * - 404: unrecognised action name
 * - 500: unexpected action error (logged to console)
 * - 200: `{ ok: true, result: <action return value> }`
 *
 * Errors never propagate as unhandled rejections — all paths return JSON.
 */
export async function handleAction(req: Request, res: Response): Promise<void> {
  const parsed = ActionRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { action, params } = parsed.data;
  const handler = actions[action];

  if (!handler) {
    res.status(404).json({ error: `Unknown action: ${action}` });
    return;
  }

  try {
    const result = await handler(params);
    res.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Action stubs throw "Invalid params: ..." for Zod validation failures —
    // these are client errors (400), not internal server errors (500).
    const isValidationError =
      err instanceof z.ZodError || message.startsWith("Invalid params:");
    if (isValidationError) {
      res.status(400).json({ ok: false, error: message });
      return;
    }
    console.error(`Action ${action} failed:`, err);
    res.status(500).json({ ok: false, error: message });
  }
}
