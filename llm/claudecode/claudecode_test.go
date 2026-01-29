package claudecode

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"shelley.exe.dev/llm"
	"shelley.exe.dev/llm/llmhttp"
)

func TestDo_Success(t *testing.T) {
	// Mock bridge server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req bridgeChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("failed to decode request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if req.Message != "Hello" {
			t.Errorf("expected message 'Hello', got %q", req.Message)
		}
		if req.ConversationID != "test-conv-123" {
			t.Errorf("expected conversation_id 'test-conv-123', got %q", req.ConversationID)
		}

		resp := bridgeChatResponse{
			Result:    "Hi there! How can I help?",
			SessionID: "cc-session-xyz",
		}
		resp.Usage.InputTokens = 100
		resp.Usage.OutputTokens = 50

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &Service{
		HTTPC:     server.Client(),
		BridgeURL: server.URL,
	}

	ctx := llmhttp.WithConversationID(context.Background(), "test-conv-123")

	resp, err := svc.Do(ctx, &llm.Request{
		Messages: []llm.Message{
			{
				Role:    llm.MessageRoleUser,
				Content: []llm.Content{{Type: llm.ContentTypeText, Text: "Hello"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("Do() returned error: %v", err)
	}

	if resp.StopReason != llm.StopReasonEndTurn {
		t.Errorf("expected StopReasonEndTurn, got %v", resp.StopReason)
	}

	if len(resp.Content) != 1 {
		t.Fatalf("expected 1 content item, got %d", len(resp.Content))
	}

	if resp.Content[0].Text != "Hi there! How can I help?" {
		t.Errorf("unexpected response text: %q", resp.Content[0].Text)
	}

	if resp.Usage.InputTokens != 100 {
		t.Errorf("expected 100 input tokens, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 50 {
		t.Errorf("expected 50 output tokens, got %d", resp.Usage.OutputTokens)
	}
}

func TestDo_BridgeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := bridgeChatResponse{
			Result:  "something went wrong",
			IsError: true,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &Service{
		HTTPC:     server.Client(),
		BridgeURL: server.URL,
	}

	ctx := llmhttp.WithConversationID(context.Background(), "test-conv")

	_, err := svc.Do(ctx, &llm.Request{
		Messages: []llm.Message{
			{
				Role:    llm.MessageRoleUser,
				Content: []llm.Content{{Type: llm.ContentTypeText, Text: "Hello"}},
			},
		},
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestDo_NoUserMessage(t *testing.T) {
	svc := &Service{
		BridgeURL: "http://localhost:9999",
	}

	_, err := svc.Do(context.Background(), &llm.Request{
		Messages: []llm.Message{
			{
				Role:    llm.MessageRoleAssistant,
				Content: []llm.Content{{Type: llm.ContentTypeText, Text: "I am assistant"}},
			},
		},
	})

	if err == nil {
		t.Fatal("expected error for missing user message, got nil")
	}
}

func TestDo_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	svc := &Service{
		HTTPC:     server.Client(),
		BridgeURL: server.URL,
	}

	ctx := llmhttp.WithConversationID(context.Background(), "test")

	_, err := svc.Do(ctx, &llm.Request{
		Messages: []llm.Message{
			{
				Role:    llm.MessageRoleUser,
				Content: []llm.Content{{Type: llm.ContentTypeText, Text: "Hello"}},
			},
		},
	})

	if err == nil {
		t.Fatal("expected error for HTTP 503, got nil")
	}
}

func TestTokenContextWindow(t *testing.T) {
	svc := &Service{}
	if got := svc.TokenContextWindow(); got != 200000 {
		t.Errorf("expected 200000, got %d", got)
	}
}

func TestMaxImageDimension(t *testing.T) {
	svc := &Service{}
	if got := svc.MaxImageDimension(); got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestExtractLastUserMessage(t *testing.T) {
	tests := []struct {
		name     string
		messages []llm.Message
		want     string
	}{
		{
			name:     "empty",
			messages: nil,
			want:     "",
		},
		{
			name: "single user message",
			messages: []llm.Message{
				{Role: llm.MessageRoleUser, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "hello"}}},
			},
			want: "hello",
		},
		{
			name: "multiple messages returns last user",
			messages: []llm.Message{
				{Role: llm.MessageRoleUser, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "first"}}},
				{Role: llm.MessageRoleAssistant, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "response"}}},
				{Role: llm.MessageRoleUser, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "second"}}},
			},
			want: "second",
		},
		{
			name: "only assistant messages",
			messages: []llm.Message{
				{Role: llm.MessageRoleAssistant, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "response"}}},
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractLastUserMessage(tt.messages)
			if got != tt.want {
				t.Errorf("extractLastUserMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}
