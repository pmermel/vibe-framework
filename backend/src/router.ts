import { Router } from "express";
import { handleAction } from "./handler.js";

/**
 * router
 *
 * Express router that wires up the two public endpoints:
 * - GET  /health  — liveness probe, returns `{ status: "ok" }`. No auth required.
 * - POST /action  — MCP-compatible action dispatcher. Accepts
 *                   `{ action: string, params?: object }` and delegates to
 *                   the appropriate action handler via handleAction.
 *
 * Does NOT implement authentication — auth is a future concern and will be
 * added as middleware before this router is mounted.
 */
export const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// MCP-compatible action endpoint
// POST /action { "action": "<name>", "params": { ... } }
router.post("/action", handleAction);
