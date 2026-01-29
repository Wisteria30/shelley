// Package claudecode provides an llm.Service implementation that delegates
// to a Claude Code bridge server. The bridge server runs Claude Code CLI
// via the Agent SDK and exposes it as a simple HTTP API.
package claudecode

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"shelley.exe.dev/llm"
	"shelley.exe.dev/llm/llmhttp"
)

// Service implements llm.Service by forwarding requests to a bridge server
// that routes to Claude Code or Codex based on the Model field.
type Service struct {
	HTTPC     *http.Client
	BridgeURL string // e.g. "http://localhost:9100"
	Model     string // e.g. "claude-code" or "codex" — passed to bridge for routing
}

// bridgeChatRequest is the JSON body sent to POST /chat on the bridge.
type bridgeChatRequest struct {
	ConversationID string `json:"conversation_id"`
	Message        string `json:"message"`
	WorkingDir     string `json:"working_dir"`
	Model          string `json:"model,omitempty"`
}

// bridgeChatResponse is the JSON body returned from POST /chat.
type bridgeChatResponse struct {
	Result    string `json:"result"`
	SessionID string `json:"session_id"`
	Usage     struct {
		InputTokens  uint64 `json:"input_tokens"`
		OutputTokens uint64 `json:"output_tokens"`
	} `json:"usage"`
	IsError   bool `json:"is_error"`
	Compacted bool `json:"compacted"`
}

// Do sends the last user message to the bridge and returns the result.
// It always returns StopReasonEndTurn so that Shelley's loop does not
// attempt to execute any tool calls (Claude Code handles tools internally).
func (s *Service) Do(ctx context.Context, req *llm.Request) (*llm.Response, error) {
	// Extract the last user message text
	userMessage := extractLastUserMessage(req.Messages)
	if userMessage == "" {
		return nil, fmt.Errorf("claudecode: no user message found in request")
	}

	// Get conversation ID from context (set by convo.go via llmhttp.WithConversationID)
	conversationID := llmhttp.ConversationIDFromContext(ctx)
	if conversationID == "" {
		conversationID = "default"
	}

	bridgeReq := bridgeChatRequest{
		ConversationID: conversationID,
		Message:        userMessage,
		Model:          s.Model,
	}

	body, err := json.Marshal(bridgeReq)
	if err != nil {
		return nil, fmt.Errorf("claudecode: failed to marshal request: %w", err)
	}

	url := s.BridgeURL + "/chat"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("claudecode: failed to create HTTP request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()

	httpc := s.HTTPC
	if httpc == nil {
		httpc = http.DefaultClient
	}

	httpResp, err := httpc.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("claudecode: bridge request failed: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("claudecode: failed to read bridge response: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("claudecode: bridge returned status %d: %s", httpResp.StatusCode, string(respBody))
	}

	var bridgeResp bridgeChatResponse
	if err := json.Unmarshal(respBody, &bridgeResp); err != nil {
		return nil, fmt.Errorf("claudecode: failed to unmarshal bridge response: %w", err)
	}

	if bridgeResp.IsError {
		return nil, fmt.Errorf("claudecode: bridge error: %s", bridgeResp.Result)
	}

	end := time.Now()

	inputTokens := bridgeResp.Usage.InputTokens
	outputTokens := bridgeResp.Usage.OutputTokens

	if bridgeResp.Compacted {
		// Context was compacted: set input tokens to max so the gauge shows full.
		inputTokens = uint64(s.TokenContextWindow())
		outputTokens = 0
	}

	return &llm.Response{
		Role: llm.MessageRoleAssistant,
		Content: []llm.Content{
			{
				Type: llm.ContentTypeText,
				Text: bridgeResp.Result,
			},
		},
		StopReason: llm.StopReasonEndTurn,
		Usage: llm.Usage{
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
			StartTime:    &start,
			EndTime:      &end,
		},
	}, nil
}

// TokenContextWindow returns the context window size for Claude Code.
func (s *Service) TokenContextWindow() int {
	return 200000
}

// MaxImageDimension returns 0 since image handling is managed by Claude Code.
func (s *Service) MaxImageDimension() int {
	return 0
}

// extractLastUserMessage finds the text of the most recent user message.
func extractLastUserMessage(messages []llm.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if msg.Role != llm.MessageRoleUser {
			continue
		}
		for _, c := range msg.Content {
			if c.Type == llm.ContentTypeText && c.Text != "" {
				return c.Text
			}
		}
	}
	return ""
}
