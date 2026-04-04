import { Router } from "express";
import { handleAction } from "./handler.js";

export const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// MCP-compatible action endpoint
// POST /action { "action": "<name>", "params": { ... } }
router.post("/action", handleAction);
