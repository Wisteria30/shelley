import { Codex } from "@openai/codex-sdk";
import { ChatRequest, ChatResponse } from "./types.js";
import { SessionManager } from "./session-manager.js";

export class CodexAdapter {
  private sessionManager: SessionManager;
  private codex: Codex;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.codex = new Codex();
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const existingThreadId = this.sessionManager.get(req.conversation_id);

    let resultText = "";
    let threadId = "";
    let isError = false;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const thread = existingThreadId
        ? this.codex.resumeThread(existingThreadId)
        : this.codex.startThread({
            workingDirectory: req.working_dir || process.cwd(),
          });

      const turn = await thread.run(req.message);

      threadId = thread.id || "";
      resultText = turn.finalResponse || "";

      if (turn.usage) {
        inputTokens = turn.usage.input_tokens || 0;
        outputTokens = turn.usage.output_tokens || 0;
      }

      // Store thread mapping for future turns
      if (threadId) {
        this.sessionManager.set(req.conversation_id, threadId);
      }
    } catch (err: unknown) {
      isError = true;
      resultText =
        err instanceof Error ? err.message : "Unknown error from Codex";
      console.error(
        `[codex-adapter] error for conversation ${req.conversation_id}:`,
        err
      );
    }

    return {
      result: resultText,
      session_id: threadId || existingThreadId || "",
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
      is_error: isError,
    };
  }

  deleteSession(conversationId: string): boolean {
    return this.sessionManager.delete(conversationId);
  }
}
