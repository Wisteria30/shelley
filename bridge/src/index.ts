import express from "express";
import { SessionManager } from "./session-manager.js";
import { ClaudeAdapter } from "./claude-adapter.js";
import { CodexAdapter } from "./codex-adapter.js";
import { ChatRequest, ChatResponse, HealthResponse } from "./types.js";

const PORT = parseInt(process.env.BRIDGE_PORT || "9100", 10);

const app = express();
app.use(express.json());

const claudeSessionManager = new SessionManager();
const codexSessionManager = new SessionManager();
const claudeAdapter = new ClaudeAdapter(claudeSessionManager);
const codexAdapter = new CodexAdapter(codexSessionManager);

// Start cleanup intervals
const cleanupTimer1 = claudeSessionManager.startCleanupInterval();
const cleanupTimer2 = codexSessionManager.startCleanupInterval();

function isCodexModel(model?: string): boolean {
  return model === "codex" || (!!model && model.startsWith("codex-"));
}

// Health check
app.get("/health", (_req, res) => {
  const response: HealthResponse = {
    status: "ok",
    active_sessions:
      claudeSessionManager.activeCount + codexSessionManager.activeCount,
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

  const backend = isCodexModel(body.model) ? "codex" : "claude-code";
  console.log(
    `[bridge] POST /chat backend=${backend} conversation_id=${body.conversation_id} message_length=${body.message.length}`
  );

  try {
    const adapter = isCodexModel(body.model) ? codexAdapter : claudeAdapter;
    const response = await adapter.chat(body);
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
  const deletedClaude = claudeAdapter.deleteSession(conversationId);
  const deletedCodex = codexAdapter.deleteSession(conversationId);
  res.json({ deleted: deletedClaude || deletedCodex });
});

const server = app.listen(PORT, () => {
  console.log(`[bridge] Bridge server listening on port ${PORT}`);
  console.log(`[bridge] Backends: claude-code, codex`);
  console.log(`[bridge] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[bridge] shutting down...");
  clearInterval(cleanupTimer1);
  clearInterval(cleanupTimer2);
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("[bridge] shutting down...");
  clearInterval(cleanupTimer1);
  clearInterval(cleanupTimer2);
  server.close(() => process.exit(0));
});
