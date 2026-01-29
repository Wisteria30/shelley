// Request/Response types for the Bridge API

export interface ChatRequest {
  conversation_id: string;
  message: string;
  working_dir: string;
  model?: string;
}

export interface ChatResponse {
  result: string;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  is_error: boolean;
  compacted?: boolean;
}

export interface HealthResponse {
  status: "ok";
  active_sessions: number;
}

export interface SessionInfo {
  sessionId: string;
  lastActivity: number;
}
