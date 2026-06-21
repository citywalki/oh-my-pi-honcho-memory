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

Install the plugin directly from npm using the `omp` CLI:

```bash
omp install @citywalki/oh-my-pi-honcho-memory
```

To install it only for the current project:

```bash
omp install -l @citywalki/oh-my-pi-honcho-memory
```

oh-my-pi will discover the extension automatically on next startup.

### Step 3: Configure

Create `~/.honcho/config.json`:

```json
{
  "apiKey": "hch-...",
  "peerName": "zhangsan",
  "hosts": {
    "omp": {
      "workspace": "fa-dev",
      "aiPeer": "oh-my-pi"
    }
  },
  "sessionStrategy": "per-directory"
}
```

### Step 4: Verify

1. Start oh-my-pi
2. Run `/honcho-status` to verify the runtime

## What You Get

- **Persistent Memory** - oh-my-pi can retain durable context across sessions
- **Cloud or Local Deployments** - Use Honcho Cloud or point at a self-hosted or local Honcho instance
- **Workspace Mapping** - A shared Honcho workspace holds your team or organization
- **Developer Voice Isolation** - Each developer's observations are captured under their own peer
- **Git Awareness** - Detect branch switches and external commits between sessions
- **Session Mapping** - Sessions can be scoped per directory, git branch, or chat instance
- **Durable Writes** - Save explicit developer observations and conclusions
- **Memory Retrieval** - Search memory, query Honcho knowledge, and inject relevant context into prompts

## Configuration

Configuration is resolved from three sources, later sources overriding earlier ones:

1. Defaults (built-in)
2. Global: `~/.honcho/config.json`
3. Environment variables (highest precedence)

### Dedicated Config File

You can place a separate config file in any directory. The extension searches upward from the current working directory for the nearest match.

Supported file names (checked in order):
- `.honcho-memory.json` / `.honcho-memory.yml` / `.honcho-memory.yaml`
- `honcho-memory.config.json` / `honcho-memory.config.yml` / `honcho-memory.config.yaml`

To use a custom file name, set `HONCHO_MEMORY_CONFIG=acp.json`.

```json
{
  "enabled": true,
  "apiKey": "hch-...",
  "workspace": "fa-dev",
  "aiPeer": "oh-my-pi",
  "peerName": "zhangsan",
  "sessionStrategy": "per-directory",
  "sessionPeerPrefix": true,
  "saveMessages": true,
  "reasoningLevel": "low",
  "endpoint": { "environment": "production" },
  "messageUpload": {
    "maxUserTokens": null,
    "maxAssistantTokens": null,
    "summarizeAssistant": false
  },
  "contextTokens": 1200
}
```

Keys are flat — no `honcho:` wrapper needed. (If present, a top-level `honcho` key is also recognized for compatibility.) YAML works the same way.

### Dedicated Config File (Recommended)

Create `~/.honcho/config.json`:

```json
{
  "apiKey": "hch-...",
  "peerName": "zhangsan",
  "sessionStrategy": "per-directory",
  "sessionPeerPrefix": true,
  "saveMessages": true,
  "endpoint": { "environment": "production" },
  "hosts": {
    "omp": {
      "workspace": "fa-dev",
      "aiPeer": "oh-my-pi"
    }
  }
}
```

Keys are flat — no `honcho:` wrapper needed. This is the same format used by the official [claude-honcho](https://github.com/plastic-labs/claude-honcho) plugin, so you can share one config file across tools.

#### Per-Directory Overrides

Use the `directories` block to apply different settings per project (longest prefix match wins):

```json
{
  "apiKey": "hch-...",
  "hosts": {
    "omp": {
      "workspace": "default-ws",
      "aiPeer": "oh-my-pi"
    }
  },
  "directories": {
    "/Users/me/work/project-a": {
      "apiKey": "hch-company-key...",
      "workspace": "company-ws"
    },
    "/Users/me/work/project-b": {
      "apiKey": "hch-personal-key...",
      "workspace": "personal-ws",
      "sessionStrategy": "git-branch"
    }
  }
}
```


### Environment Variables

| Variable | Purpose |
| --- | --- |
| `HONCHO_API_KEY` | Honcho API key |
| `HONCHO_URL` | Honcho endpoint (overrides endpoint.baseUrl) |
| `HONCHO_WORKSPACE` | Workspace ID |
| `HONCHO_PEER_NAME` | Developer peer name |
| `HONCHO_AI_PEER` | AI peer name |
| `HONCHO_MEMORY_CONFIG` | Override dedicated config file path |

### Endpoint

Use `endpoint.environment` for well-known endpoints, or `endpoint.baseUrl` for a custom URL:

```json
{
  "endpoint": { "environment": "local" }
}
```

`environment` values: `production` (default, `https://api.honcho.dev`) or `local` (`http://127.0.0.1:8000`).

`HONCHO_URL` still works and takes precedence over `endpoint`.

### Session Strategies

| Strategy | Behavior | Best for |
| --- | --- | --- |
| `per-directory` (default) | One session per working directory, named `{peerName}-{repoName}` | Default project memory |
| `git-branch` | Session name includes the current git branch, e.g. `{peerName}-{repoName}-{branch}` | Feature-branch workflows |
| `chat-instance` | Each oh-my-pi chat gets its own session, e.g. `{peerName}-chat-{sessionId}` | Short-lived isolated work |

Session names are prefixed with your `peerName` by default. Set `sessionPeerPrefix: false` if you are the only user and want shorter names.

You can override the per-directory session name for specific directories with the `sessions` map:

```json
{
  "sessions": {
    "/Users/me/work/project-a": "alice-custom-a"
  }
}
```

## Identity Model

Everything in Honcho is a peer:

```text
workspace: fa-dev
├── peer: user-zhangsan
├── peer: user-lisi
└── peer: ai-oh-my-pi
```

- `user-{developer}` - captures each developer's voice and observations
- `ai-oh-my-pi` - the assistant identity that observes and reasons

Conversational turns are automatically saved under the current `user-{developer}` peer.

## Commands

| Command | Description |
| --- | --- |
| `/honcho-status` | Show effective Honcho status for the current oh-my-pi project, including live workspace and session names |

## Tools

The extension exposes these tools inside oh-my-pi:

| Tool | Description |
| `honcho_search` | Search Honcho session messages across developer peers |
| `honcho_get_context` | Retrieve stable memory context for the developer or AI peer |
| `honcho_get_representation` | Retrieve the developer or AI peer's representation string |
| `honcho_chat` | Query Honcho for reasoning-backed context |
| `honcho_list_conclusions` | List durable conclusions stored for the developer peer |
| `honcho_add_conclusion` | Save a durable memory conclusion to the developer peer |
| `honcho_remember` | Alias for `honcho_add_conclusion` |
| `honcho_delete_conclusion` | Delete a durable conclusion by ID |
| `honcho_get_config` | View current Honcho configuration and connection status |
| `honcho_set_config` | Update a Honcho configuration field in `~/.honcho/config.json` |
## Development

For developing or debugging this extension locally:

```bash
git clone https://github.com/citywalki/oh-my-pi-honcho-memory.git
cd oh-my-pi-honcho-memory
bun install
bun run build
omp install ./
```

Then restart oh-my-pi.

To update the installed plugin after publishing a new version:

```bash
omp update @citywalki/oh-my-pi-honcho-memory
```

## Publishing

**Do not run `npm publish` locally.** Releases are automated via GitHub Actions.

To publish a new version:

1. Make sure `main` is in a releasable state and all changes are pushed.
2. Run the release script locally to bump the version and push a tag:

```bash
bun run release patch   # or minor / major
```

This runs `npm version`, which bumps `package.json`, commits, tags `vX.Y.Z`, and pushes the tag to GitHub.

3. The `Release` workflow (`.github/workflows/release.yml`) will build the package and publish it to npm with provenance.

A `CI` workflow also runs on every push and pull request to verify the build and type checks.

## License

MIT
