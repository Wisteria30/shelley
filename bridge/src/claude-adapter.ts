import { query } from "@anthropic-ai/claude-agent-sdk";
import { ChatRequest, ChatResponse } from "./types.js";
import { SessionManager } from "./session-manager.js";

const ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

export class ClaudeAdapter {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const existingSessionId = this.sessionManager.get(req.conversation_id);

    let resultText = "";
    let sessionId = "";
    let isError = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let compacted = false;

    try {
      const queryOptions: Record<string, unknown> = {
        allowedTools: ALLOWED_TOOLS,
        permissionMode: "bypassPermissions",
      };

      if (req.working_dir) {
        queryOptions.cwd = req.working_dir;
      }

      if (existingSessionId) {
        queryOptions.resume = existingSessionId;
      }

      // NOTE: req.model is used for bridge routing (e.g. "claude-code" vs "codex")
      // and should NOT be passed to the Claude Agent SDK as a model option.
      // To specify a Claude sub-model (e.g. "sonnet", "opus"), add a separate field.

      for await (const message of query({
        prompt: req.message,
        options: queryOptions,
      })) {
        // Capture session ID from init message
        if (
          message.type === "system" &&
          (message as any).subtype === "init" &&
          (message as any).session_id
        ) {
          sessionId = (message as any).session_id;
        }

        // Detect context compaction
        if (
          message.type === "system" &&
          (message as any).subtype === "compact_boundary"
        ) {
          compacted = true;
        }

        // Capture result text
        if ("result" in message && typeof (message as any).result === "string") {
          resultText = (message as any).result;
        }

        // Capture usage from result message
        if ((message as any).cost_usd !== undefined) {
          // The SDK reports cost but not always individual token counts in every message
          // We capture what's available
        }
        if ((message as any).input_tokens !== undefined) {
          inputTokens = (message as any).input_tokens;
        }
        if ((message as any).output_tokens !== undefined) {
          outputTokens = (message as any).output_tokens;
        }
      }

      // Store session mapping for future turns
      if (sessionId) {
        this.sessionManager.set(req.conversation_id, sessionId);
      }
    } catch (err: unknown) {
      isError = true;
      resultText =
        err instanceof Error ? err.message : "Unknown error from Claude Code";
      console.error(
        `[claude-adapter] error for conversation ${req.conversation_id}:`,
        err
      );
    }

    return {
      result: resultText,
      session_id: sessionId || existingSessionId || "",
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
      is_error: isError,
      ...(compacted && { compacted: true }),
    };
  }

  deleteSession(conversationId: string): boolean {
    return this.sessionManager.delete(conversationId);
  }
}
