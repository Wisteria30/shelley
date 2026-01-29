import express from "express";
import { SessionManager } from "./session-manager.js";
import { ClaudeAdapter } from "./claude-adapter.js";
import { ChatRequest, ChatResponse, HealthResponse } from "./types.js";

const PORT = parseInt(process.env.BRIDGE_PORT || "9100", 10);

const app = express();
app.use(express.json());

const sessionManager = new SessionManager();
const claudeAdapter = new ClaudeAdapter(sessionManager);

// Start cleanup interval
const cleanupTimer = sessionManager.startCleanupInterval();

// Health check
app.get("/health", (_req, res) => {
  const response: HealthResponse = {
    status: "ok",
    active_sessions: sessionManager.activeCount,
  };
  res.json(response);
});

// Main chat endpoint (blocking)
app.post("/chat", async (req, res) => {
  const body = req.body as ChatRequest;

  if (!body.conversation_id || !body.message) {
    res.status(400).json({
      result: "",
      session_id: "",
      usage: { input_tokens: 0, output_tokens: 0 },
      is_error: true,
    } satisfies ChatResponse);
    return;
  }

  if (!body.working_dir) {
    body.working_dir = process.cwd();
  }

  console.log(
    `[bridge] POST /chat conversation_id=${body.conversation_id} message_length=${body.message.length}`
  );

  try {
    const response = await claudeAdapter.chat(body);
    res.json(response);
  } catch (err) {
    console.error("[bridge] unexpected error:", err);
    res.status(500).json({
      result: "Internal bridge error",
      session_id: "",
      usage: { input_tokens: 0, output_tokens: 0 },
      is_error: true,
    } satisfies ChatResponse);
  }
});

// Delete session
app.delete("/sessions/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  const deleted = claudeAdapter.deleteSession(conversationId);
  res.json({ deleted });
});

const server = app.listen(PORT, () => {
  console.log(`[bridge] Bridge server listening on port ${PORT}`);
  console.log(`[bridge] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[bridge] shutting down...");
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("[bridge] shutting down...");
  clearInterval(cleanupTimer);
  server.close(() => process.exit(0));
});
