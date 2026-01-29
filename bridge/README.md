# Claude Code Bridge Server

Shelley と Claude Code CLI を接続する Bridge サーバー。
Shelley (Go) から HTTP 経由でリクエストを受け取り、[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) を使って Claude Code CLI にプロキシする。

## 前提条件

- Node.js 18+
- Claude Code CLI がインストール・認証済みであること

```bash
claude --version
```

Claude Code CLI の認証が済んでいない場合は、先に `claude` コマンドを実行してログインしておく。

## セットアップ

```bash
cd bridge
npm install
```

## 起動

```bash
# 開発モード（TypeScript 直接実行）
npm run dev

# プロダクションモード
npm run build
npm start
```

デフォルトでは `http://localhost:9100` で待機する。
ポートは環境変数 `PORT` で変更可能。

```bash
PORT=9200 npm run dev
```

## Shelley との接続

Bridge を起動した状態で、Shelley 側に環境変数 `CLAUDE_CODE_BRIDGE_URL` を渡して起動する。

```bash
CLAUDE_CODE_BRIDGE_URL=http://localhost:9100 make serve
```

ブラウザで Shelley の UI を開き、モデル選択から **Claude Code (Max plan)** を選択してチャットする。

## API

### `GET /health`

ヘルスチェック。アクティブセッション数を返す。

```bash
curl http://localhost:9100/health
```

```json
{
  "status": "ok",
  "active_sessions": 0
}
```

### `POST /chat`

Claude Code にメッセージを送信する。ブロッキング（処理完了まで待つ）。

```bash
curl -X POST http://localhost:9100/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "conversation_id": "test-123",
    "message": "Hello",
    "working_dir": "/tmp"
  }'
```

```json
{
  "result": "Hello! How can I help you today?",
  "session_id": "cc-session-xyz",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  },
  "is_error": false
}
```

| フィールド | 型 | 説明 |
|-----------|------|------|
| `conversation_id` | string | Shelley の会話 ID。同じ ID で送ると Claude Code のセッションが継続する |
| `message` | string | ユーザーメッセージ |
| `working_dir` | string | Claude Code の作業ディレクトリ |
| `model` | string (任意) | Claude Code に渡すモデル名（`sonnet`, `opus` など） |

### `DELETE /sessions/:conversationId`

指定した会話のセッションを終了する。

```bash
curl -X DELETE http://localhost:9100/sessions/test-123
```

## アーキテクチャ

```
Shelley (Go)                          Bridge (Node.js)
┌──────────────────┐                  ┌──────────────────────────┐
│ llm/claudecode/  │── HTTP POST ───> │ Express server           │
│ claudecode.go    │                  │   ├── claude-adapter.ts  │
│                  │<── JSON resp ──  │   │   └── query()        │
└──────────────────┘                  │   └── session-manager.ts │
                                      └──────────────────────────┘
                                               │
                                               ▼
                                      Claude Code CLI (subprocess)
```

- **session-manager**: Shelley の `conversation_id` と Claude Code の `session_id` を対応付け、マルチターン会話を実現する。30 分のアイドルタイムアウトで自動クリーンアップ。
- **claude-adapter**: Agent SDK の `query()` を呼び出し、Claude Code をサブプロセスとして実行する。`permissionMode: "bypassPermissions"` で自動承認。
