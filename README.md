# Honcho Extension for oh-my-pi

> Add AI-native memory to oh-my-pi

[English](README.md) | [中文](README_CN.md)

Give oh-my-pi long-term memory that survives context wipes, session restarts, and fresh chats. Honcho remembers what you're working on, durable preferences, and prior context across your projects.

## Quick Start

### Step 1: Get Your Honcho API Key

1. Go to **[app.honcho.dev](https://app.honcho.dev)**
2. Sign up or log in
3. Copy your API key

### Step 2: Install the Extension

Clone this extension into oh-my-pi's user extension discovery path:

```bash
git clone https://github.com/citywalki/oh-my-pi-honcho-memory.git \
  ~/.omp/agent/extensions/oh-my-pi-honcho-memory
cd ~/.omp/agent/extensions/oh-my-pi-honcho-memory
bun install
bun run build
```

oh-my-pi will discover the extension automatically from `~/.omp/agent/extensions/` on next startup.

### Step 3: Configure

Create or edit `~/.omp/agent/config.yml`:

```yaml
honcho:
  enabled: true
  url: https://api.honcho.dev
  apiKey: hch-...
  workspace: fa-dev
  aiPeer: oh-my-pi
  peerName: zhangsan
  sessionStrategy: per-repo
```

In each project, create `.omp/config.yml` to set the project peer:

```yaml
honcho:
  projectPeer: project-sysA-product
```

### Step 4: Verify

1. Start oh-my-pi
2. Run `/honcho-status` to verify the runtime
3. Run `/honcho-save-to-project We use Zod for runtime validation` to test durable writes

## What You Get

- **Persistent Memory** - oh-my-pi can retain durable context across sessions
- **Cloud or Local Deployments** - Use Honcho Cloud or point at a self-hosted or local Honcho instance
- **Workspace Mapping** - A shared Honcho workspace holds your team or organization
- **Project Peer Mapping** - Each project maps to a dedicated Honcho peer for isolated project memory
- **Developer Voice Isolation** - Each developer's observations are captured under their own peer
- **Session Mapping** - Sessions can be scoped per directory, repo, or globally
- **Durable Writes** - Save explicit project conclusions and developer observations
- **Memory Retrieval** - Search memory, query Honcho knowledge, and inject relevant context into prompts

## Configuration

Configuration is resolved from three sources, later sources overriding earlier ones:

1. Global: `~/.omp/agent/config.yml`
2. Project: `<repo>/.omp/config.yml`
3. Environment variables (highest precedence)

### Global Config

```yaml
honcho:
  enabled: true
  url: https://api.honcho.dev
  apiKey: hch-...
  workspace: fa-dev
  aiPeer: oh-my-pi
  peerName: zhangsan
  sessionStrategy: per-repo
  contextTokens: 1200
  commitEveryNTurns: 4
```

### Project Config

```yaml
honcho:
  projectPeer: project-sysA-product
```

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `HONCHO_API_KEY` | Honcho API key |
| `HONCHO_URL` | Honcho endpoint |
| `HONCHO_WORKSPACE` | Workspace ID |
| `HONCHO_PEER_NAME` | Developer peer name |
| `HONCHO_AI_PEER` | AI peer name |
| `HONCHO_PROJECT_PEER` | Active project peer name |

### Cloud vs Local

For Honcho Cloud:

- `apiKey` is required
- `url` should remain `https://api.honcho.dev`

For self-hosted or local Honcho:

- `url` should point to your deployment, for example `http://127.0.0.1:8000`
- `apiKey` is required only if that deployment requires authentication

### Session Strategies

| Strategy | Behavior | Best for |
| --- | --- | --- |
| `per-directory` | One session per working directory | Default project memory |
| `per-repo` | One session per repository | Repos with multiple entry directories |
| `per-session` | New session for each oh-my-pi session id | Short-lived isolated work |
| `global` | One session for everything | Shared memory across all work |

## Identity Model

Everything in Honcho is a peer:

```text
workspace: fa-dev
├── peer: user-zhangsan
├── peer: user-lisi
├── peer: project-sysA-product
├── peer: project-sysA-clientA
└── peer: ai-oh-my-pi
```

- `user:{developer}` - captures each developer's voice and observations
- `project:{id}` - captures team conventions and project decisions
- `ai:oh-my-pi` - the assistant identity that observes and reasons

Conversational turns are automatically saved under the current `user:{developer}` peer. Project knowledge is only written when explicitly saved.

## Commands

| Command | Description |
| --- | --- |
| `/honcho-status` | Show effective Honcho status for the current oh-my-pi project, including live workspace and session names |
| `/honcho-save-to-project <fact>` | Save a durable fact to the active project peer |

## Tools

The extension exposes these tools inside oh-my-pi:

| Tool | Description |
| --- | --- |
| `honcho_search` | Search Honcho session messages across developer and project peers |
| `honcho_chat` | Query Honcho for reasoning-backed context |
| `honcho_remember` | Save a durable memory conclusion to the developer or project peer |

## Development

For local testing:

```bash
git clone https://github.com/citywalki/oh-my-pi-honcho-memory.git
cd oh-my-pi-honcho-memory
bun install
bun run build
ln -s "$PWD" ~/.omp/agent/extensions/oh-my-pi-honcho-memory
```

Then restart oh-my-pi.

## Publishing

Releases are automated via GitHub Actions. To publish a new version:

1. Run the release script locally:

```bash
bun run release patch   # or minor / major
```

This bumps `package.json`, commits, tags `vX.Y.Z`, and pushes the tag.

2. The `Release` workflow builds the package and publishes it to npm with provenance.

A `CI` workflow also runs on every push and pull request to verify the build and type checks.

## License

MIT
