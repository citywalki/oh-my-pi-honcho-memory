# Repository Guidelines

> 本仓库指南面向需要理解和修改 `@citywalki/oh-my-pi-honcho-memory` 的 AI 助手。

## Project Overview

`@citywalki/oh-my-pi-honcho-memory` 是一个 oh-my-pi 扩展

扩展运行在 oh-my-pi 宿主内，注册工具与斜杠命令，并监听 Agent 生命周期事件自动读写记忆。

## Architecture & Data Flow

扩展的核心是一个默认导出的安装函数 `honchoMemoryExtension(pi: ExtensionAPI)`，由 oh-my-pi 宿主在启动时调用。

```text
oh-my-pi host
    │
    ├── 调用 honchoMemoryExtension(pi: ExtensionAPI)
    │       │
    │       ├── 解析配置：默认值 → ~/.honcho/config.json → 环境变量
    │       ├── 根据工作目录、Git 分支或聊天实例生成 SessionKey
    │       ├── 注册工具：honcho_search、honcho_get_context、honcho_get_representation、honcho_chat、honcho_list_conclusions、honcho_add_conclusion、honcho_remember、honcho_delete_conclusion、honcho_get_config、honcho_set_config
    │       └── 注册命令：/honcho-status、/honcho-config、/honcho-setup
    │
    ├── session_start / session_switch  → 加载记忆上下文
    ├── before_agent_start              → 将编译后的记忆注入 system prompt
    ├── agent_end                       → 每轮对话结束后增量保存用户/助手消息
    └── session_shutdown                → 上传 session 结束标记并释放内存状态
```

### 关键模块职责

| 文件 | 职责 |
|------|------|
| `extensions/index.ts` | 扩展入口；管理会话状态、事件监听、工具与命令注册 |
| `extensions/config.ts` | 多层配置解析与默认值处理 |
| `extensions/session-key.ts` | 根据策略、peerName、当前目录与 `sessions` 覆盖生成归一化的 `SessionKey` |
| `extensions/git.ts` | 捕获 git 状态、检测变化、推断 feature context |
| `extensions/memory.ts` | 上下文加载、prompt 上下文刷新、编译与持久化 |
| `extensions/tools.ts` | 基于 Zod 的工具定义与执行逻辑 |
| `extensions/commands.ts` | 斜杠命令处理 |
| `types/oh-my-pi.d.ts` | oh-my-pi 宿主 API 的 ambient 类型声明 |

### 关键架构选择

- **按会话的内存状态**：使用 `Map<SessionKey, SessionState>` 保存每个会话的句柄与缓存。
- **延迟启动**：每个 `SessionKey` 只创建一次 `HonchoHandles`，后续复用。
- **分层配置**：YAML 文件与环境变量合并，后层覆盖前层。
- **Peer 身份模型**：Honcho 中一切皆 peer，共享同一个 workspace。
  - `user-{peerName}` —— 开发者专属观察
  - `ai-{aiPeer}` —— 助手身份
- **会话作用域**：`per-directory`、`git-branch`、`chat-instance`，默认 `per-directory`；支持 `sessions` 手动覆盖。
- **Git 感知**：session 启动时捕获分支/commit/脏文件，上传外部变更作为观察。
- **Dialectic 预热**：session 启动时触发 fire-and-forget 的 `peer.chat()` 查询以预热知识图谱。
- **Message upload**：`saveMessages` 与 `messageUpload` 控制是否保存及截断消息。
- **生命周期映射差异**：oh-my-pi 没有 Claude Code 的 `session_end` 钩子；本扩展使用 `agent_end` 做增量保存（每个 turn 结束时入队），`session_switch` / `session_before_compact` / `session_shutdown` 调用 `flushPending()` 排空队列。`session_shutdown` 在 oh-my-pi 中有 2s 处理器超时，因此关键上传不能仅依赖该事件。

| 目录 | 用途 |
|------|------|
| `extensions/` | 全部扩展源码 |
| `types/` | oh-my-pi 宿主 API 的 ambient 类型声明 |
| `dist/` | 构建产物（git 忽略，发布到 npm） |
| `.github/workflows/` | CI 与发布自动化 |

## Development Commands

本地开发与构建均使用 Bun。

```bash
# 安装依赖
bun install

# 类型检查（不输出文件）
bun run check

# 构建扩展 JS bundle + 类型声明
bun run build

# 清理构建产物
bun run clean

# 升级版本：运行 npm version 并触发 postversion 推送标签
bun run release patch   # 或 minor / major
# 推送 v* 标签后会触发 Release 工作流自动发布到 npm

本地构建后安装到 oh-my-pi：

```bash
bun run build
omp install ./
```

## Code Conventions & Common Patterns

### 模块结构

- `extensions/` 下每个文件职责单一，统一由 `index.ts` 导入。
- 本地导入使用显式 `.js` 扩展名，以适配 NodeNext 模块解析：
  ```ts
  import { createHonchoHandles } from "./client.js";
  ```
- 宿主 API 不安装为依赖，而是通过 `types/oh-my-pi.d.ts` 提供类型。

### 异步与错误处理

- 所有 SDK/网络调用优先使用 `async`/`await`。
- 独立获取可优雅失败时，使用 `Promise.allSettled`（如 `hydrateMemoryContext`）。
- 工具捕获错误后返回 `AgentToolResult` 并设置 `isError: true`，而不是抛出。
- 配置缺失或无效时返回 `null` 句柄，事件处理短路退出。

### 依赖注入

- `commands.ts` 与 `tools.ts` 接收小型依赖接口：
  ```ts
  interface ToolRegistryDependencies {
    getHandles: (ctx: ExtensionContext) => Promise<HonchoHandles | null>;
  }
  ```
- 这让模块与宿主运行时解耦，也便于测试。

### 状态管理

- 内存状态以归一化的 `SessionKey` 为键。
- `cachedPromptContext` 缓存 prompt 上下文，避免同一会话重复向量检索。
- `session_before_compact` 事件会清空该缓存。

### 命名与格式

- TypeScript 启用 `strict: true`；导出的函数建议显式返回类型。
- Peer / session ID 归一化为小写 kebab-case；session 名默认带 `peerName` 前缀。
- 配置遵循 Honcho 官方 Claude Code 插件格式：`~/.honcho/config.json`，支持 `hosts.omp`、`directories`、`endpoint`、`sessions`。
- 常量与默认值放在各自模块内。
- 当前未配置 linter 或 formatter，依靠 TypeScript 严格模式与人工保持一致。

## Important Files

| 文件 | 重要性 |
|------|--------|
| `extensions/index.ts` | 扩展入口；注册事件处理器、工具与命令 |
| `extensions/client.ts` | Honcho SDK 封装；导出 `createHonchoHandles` 与本地接口 |
| `extensions/config.ts` | 配置解析与校验 |
| `extensions/memory.ts` | 上下文加载、prompt 编译与持久化辅助函数 |
| `extensions/session-key.ts` | 项目根目录探测与会话键生成 |
| `extensions/commands.ts` | 斜杠命令处理器 |
| `package.json` | 脚本、依赖、`omp.extensions` 发现入口 |
| `tsconfig.json` | ES2022 / NodeNext / strict / 声明输出 |
| `.github/workflows/release.yml` | 基于 `v*` 标签自动发布到 npm（带 provenance） |

## Runtime/Tooling Preferences

- **主要运行时**：Bun。CI、开发说明与构建目标均使用 Bun。
- **包管理器**：Bun（`bun.lock`）。
- **ESM 包**：`"type": "module"`，仅输出 ESM。
- **最低 Node 版本**：`engines` 声明 `>=18`，但实际开发与构建使用 Bun。
- **TypeScript**：`^5.9.3`，启用 strict 模式与 NodeNext 模块解析。
- **打包器**：`bun build` 将 `extensions/index.ts` 打包为 `--target bun`，并将 `@oh-my-pi/pi-coding-agent` 标记为 external。
- **声明输出**：`tsc --emitDeclarationOnly` 将 `.d.ts` 写入 `dist/`；未配置 source map。
- **发布**：`bun run release patch|minor|major` 调用 `npm version`，`postversion` 自动推送标签；Release 工作流使用 `npm publish --provenance --access public`。
- **当前未配置 linter 或 formatter**。

## Testing & QA

- **单元测试**：`bun test test/`（当前覆盖 memory、config、session-key、message-utils、extension-registration、observation-mode）
- 质量门禁：
  1. `bun run check` —— TypeScript 类型检查（`tsc --noEmit`）
  2. `bun run build` —— Bun 打包 + 类型声明输出
  3. `bun test test/` —— 单元测试
- CI 在每次推送到 `main` 分支或针对 `main` 的 PR 上运行上述门禁（见 `.github/workflows/ci.yml`）。

### 本地测试步骤

修改代码后，先跑门禁：

```bash
bun run check
bun run build
bun test test/
```

加载到 oh-my-pi 验证（按 omp 扩展编写规范，三种等价方式任选其一）：

**方式一：安装为插件（推荐，支持文件监听热更新）**

```bash
bun run build
omp install ./          # 全局安装
omp install -l ./       # 或仅当前项目（-l / --local）
```

**方式二：一次会话挂载**

```bash
bun run build
omp --extension ./
```

**方式三：配置文件指向目录**

在 `~/.omp/agent/config.yml` 中添加：

```yaml
extensions:
  - /path/to/oh-my-pi-honcho-memory
```

确认加载成功：

```bash
omp -p '/extensions'              # 查看已加载的扩展列表
omp --log-level debug              # 启动时可看到各 surface 的加载日志
```

### 手动功能验证

1. 启动 oh-my-pi
2. 运行 `/honcho-status` 验证初始化状态
3. 运行 `/honcho-save-to-project <fact>` 测试持久化写入
4. 运行 `/honcho-save-to-user <fact>` 测试用户记忆写入
5. 检查 AI 是否能通过 `honcho_search` 召回已写入的记忆
