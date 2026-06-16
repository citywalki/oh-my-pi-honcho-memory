# oh-my-pi Honcho Memory

Multi-developer memory extension for [oh-my-pi](https://github.com/can1357/oh-my-pi), backed by [Honcho](https://honcho.dev).

## What it does

- Keeps a **developer peer** for each user, capturing personal observations and working style.
- Keeps a **project peer** per repository, capturing team conventions and decisions.
- Injects cached memory into the system prompt before each agent turn.
- Persists conversation turns to Honcho automatically.
- Provides `/honcho-status`, `/honcho-save-to-project`, and LLM-callable tools.

Documents and code snippets are **not** stored in Honcho; use RAGFlow or another RAG system for those.

## Installation

```bash
git clone https://github.com/your-org/oh-my-pi-honcho-memory.git
# or place the folder under ~/.omp/agent/extensions/oh-my-pi-honcho-memory
cd ~/.omp/agent/extensions/oh-my-pi-honcho-memory
bun install
bun run build
```

oh-my-pi will auto-discover the extension from `~/.omp/agent/extensions/`.

## Configuration

### Global (`~/.omp/agent/config.yml`)

```yaml
honcho:
  enabled: true
  url: https://api.honcho.dev
  apiKey: hch-...            # or use HONCHO_API_KEY env var
  workspace: fa-dev
  aiPeer: oh-my-pi
  peerName: zhangsan         # current developer
  sessionStrategy: per-repo
  contextTokens: 1200
  commitEveryNTurns: 4
```

### Project (`<repo>/.omp/config.yml`)

```yaml
honcho:
  projectPeer: project-sysA-product
```

### Environment variables

- `HONCHO_API_KEY`
- `HONCHO_URL`
- `HONCHO_WORKSPACE`
- `HONCHO_PEER_NAME`
- `HONCHO_AI_PEER`
- `HONCHO_PROJECT_PEER`

Environment variables take highest precedence.

## Usage

- `/honcho-status` — show active workspace, session, and peers.
- `/honcho-save-to-project <fact>` — save a durable fact to the project peer.
- LLM tools: `honcho_search`, `honcho_chat`, `honcho_remember`.

## License

MIT
