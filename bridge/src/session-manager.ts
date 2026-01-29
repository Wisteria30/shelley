import { SessionInfo } from "./types.js";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  // Maps Shelley conversation_id → Claude Code session_id
  private sessions: Map<string, SessionInfo> = new Map();

  get(conversationId: string): string | undefined {
    const info = this.sessions.get(conversationId);
    if (info) {
      info.lastActivity = Date.now();
      return info.sessionId;
    }
    return undefined;
  }

  set(conversationId: string, sessionId: string): void {
    this.sessions.set(conversationId, {
      sessionId,
      lastActivity: Date.now(),
    });
  }

  delete(conversationId: string): boolean {
    return this.sessions.delete(conversationId);
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, info] of this.sessions) {
      if (now - info.lastActivity > IDLE_TIMEOUT_MS) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  startCleanupInterval(): NodeJS.Timeout {
    return setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        console.log(`[session-manager] cleaned up ${removed} idle session(s)`);
      }
    }, 5 * 60 * 1000); // every 5 minutes
  }
}
