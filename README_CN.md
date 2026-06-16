# oh-my-pi 的 Honcho 记忆扩展

> 为 oh-my-pi 添加 AI 原生长期记忆

[English](README.md) | [中文](README_CN.md)

让 oh-my-pi 拥有跨会话、跨重启的长期记忆能力。Honcho 会记住你正在做什么、持久化的偏好设置，以及各个项目中的上下文。

## 快速开始

### 第一步：获取 Honcho API Key

1. 打开 **[app.honcho.dev](https://app.honcho.dev)**
2. 注册或登录
3. 复制你的 API key

### 第二步：安装扩展

将本扩展克隆到 oh-my-pi 的用户扩展发现路径：

```bash
git clone https://github.com/citywalki/oh-my-pi-honcho-memory.git \
  ~/.omp/agent/extensions/oh-my-pi-honcho-memory
cd ~/.omp/agent/extensions/oh-my-pi-honcho-memory
bun install
bun run build
```

oh-my-pi 下次启动时会自动从 `~/.omp/agent/extensions/` 加载该扩展。

### 第三步：配置

创建或编辑 `~/.omp/agent/config.yml`：

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

在每个项目中创建 `.omp/config.yml` 设置项目 peer：

```yaml
honcho:
  projectPeer: project-sysA-product
```

### 第四步：验证

1. 启动 oh-my-pi
2. 运行 `/honcho-status` 验证运行时状态
3. 运行 `/honcho-save-to-project 我们用 Zod 做运行时校验` 测试持久化写入

## 功能特性

- **持久化记忆** - oh-my-pi 可以跨会话保留长期上下文
- **云端或本地部署** - 使用 Honcho Cloud，或指向自托管/本地 Honcho 实例
- **工作空间映射** - 一个共享的 Honcho workspace 承载团队或组织
- **项目 Peer 映射** - 每个项目对应一个独立的 Honcho peer，项目记忆相互隔离
- **开发者声音隔离** - 每个开发者的观察记录在自己的 peer 下
- **会话映射** - 支持按目录、仓库或全局范围划分会话
- **持久化写入** - 保存明确的项目结论和开发者观察
- **记忆检索** - 搜索记忆、查询 Honcho 知识，并将相关上下文注入提示词

## 配置说明

配置从三个来源合并，后写入的会覆盖前面的：

1. 全局配置：`~/.omp/agent/config.yml`
2. 项目配置：`<repo>/.omp/config.yml`
3. 环境变量（最高优先级）

### 全局配置

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

### 项目配置

```yaml
honcho:
  projectPeer: project-sysA-product
```

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `HONCHO_API_KEY` | Honcho API key |
| `HONCHO_URL` | Honcho 服务端点 |
| `HONCHO_WORKSPACE` | Workspace ID |
| `HONCHO_PEER_NAME` | 开发者 peer 名称 |
| `HONCHO_AI_PEER` | AI peer 名称 |
| `HONCHO_PROJECT_PEER` | 当前项目 peer 名称 |

### 云端 vs 本地

使用 Honcho Cloud：

- 必须提供 `apiKey`
- `url` 保持 `https://api.honcho.dev`

使用自托管或本地 Honcho：

- `url` 指向你的部署地址，例如 `http://127.0.0.1:8000`
- 仅当部署需要认证时才提供 `apiKey`

### 会话策略

| 策略 | 行为 | 适用场景 |
| --- | --- | --- |
| `per-directory` | 每个工作目录一个会话 | 默认项目记忆 |
| `per-repo` | 每个仓库一个会话 | 单个仓库有多个入口目录 |
| `per-session` | 每个 oh-my-pi 会话 ID 一个新会话 | 短期隔离工作 |
| `global` | 所有工作共用一个会话 | 跨项目共享记忆 |

## 身份模型

在 Honcho 中，一切皆 peer：

```text
workspace: fa-dev
├── peer: user-zhangsan
├── peer: user-lisi
├── peer: project-sysA-product
├── peer: project-sysA-clientA
└── peer: ai-oh-my-pi
```

- `user:{developer}` - 记录每个开发者的声音和观察
- `project:{id}` - 记录团队约定和项目决策
- `ai:oh-my-pi` - 助理身份，负责观察和推理

对话回合会自动保存到当前的 `user:{developer}` peer。项目知识仅在显式保存时写入。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/honcho-status` | 显示当前 oh-my-pi 项目的 Honcho 状态，包括 workspace 和 session 名称 |
| `/honcho-save-to-project <事实>` | 将一条持久化事实保存到当前项目 peer |

## 工具

扩展向 oh-my-pi 暴露了以下工具：

| 工具 | 说明 |
| --- | --- |
| `honcho_search` | 跨开发者和项目 peer 搜索 Honcho 会话消息 |
| `honcho_chat` | 向 Honcho 查询基于推理的上下文 |
| `honcho_remember` | 将持久化结论保存到开发者或项目 peer |

## 本地开发

本地测试流程：

```bash
git clone https://github.com/citywalki/oh-my-pi-honcho-memory.git
cd oh-my-pi-honcho-memory
bun install
bun run build
ln -s "$PWD" ~/.omp/agent/extensions/oh-my-pi-honcho-memory
```

然后重启 oh-my-pi。

## 发布

发布流程由 GitHub Actions 自动化。发布新版本：

1. 本地执行发布脚本：

```bash
bun run release patch   # 或 minor / major
```

这会更新 `package.json` 版本号，创建提交，打标签 `vX.Y.Z`，并推送标签。

2. `Release` 工作流会自动构建并发布到 npm，并附带 provenance 证明。

每次推送和 Pull Request 都会触发 `CI` 工作流，执行构建和类型检查。

## 许可证

MIT
