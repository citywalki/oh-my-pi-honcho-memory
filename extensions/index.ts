import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { createHonchoHandles, type HonchoHandles, type SessionKey } from "./client.js";
import { resolveConfig, isConfigured } from "./config.js";
import {
	compileMemoryContext,
	hydrateMemoryContext,
	refreshPromptContext,
	saveUserMessage,
	saveAssistantMessage,
	saveToolSummary,
	saveUserConclusion,
	formatContinuityContext,
} from "./memory.js";
import {
	extractTextFromMessage,
	collectMessagePairs,
	collectToolSummary,
	extractDurableConclusion,
} from "./message-utils.js";
import { buildSessionKey, deriveProjectRoot } from "./session-key.js";
import { registerCommands } from "./commands.js";
import { registerTools } from "./tools.js";

interface SessionState {
	handles: HonchoHandles | null;
	lastMemoryContext: string | null;
	cachedPromptContext: string | null;
	lastPromptContextQuery: string | null;
	lastUserTurnCount: number;
	recentConclusions: string[];
}

function createSessionState(): SessionState {
	return {
		handles: null,
		lastMemoryContext: null,
		cachedPromptContext: null,
		lastPromptContextQuery: null,
		lastUserTurnCount: 0,
		recentConclusions: [],
	};
}

export default function honchoMemoryExtension(pi: ExtensionAPI): void {
	const sessions = new Map<SessionKey, SessionState>();

	function getState(sessionKey: SessionKey): SessionState {
		let state = sessions.get(sessionKey);
		if (!state) {
			state = createSessionState();
			sessions.set(sessionKey, state);
		}
		return state;
	}

	function deriveSessionKey(cwd: string, sessionId: string): SessionKey {
		const rootDir = deriveProjectRoot(cwd);
		const config = resolveConfig(cwd);
		return buildSessionKey({
			sessionStrategy: config.sessionStrategy,
			rootDir,
			cwd,
			sessionId,
		});
	}

	async function bootstrap(cwd: string, sessionId: string): Promise<HonchoHandles | null> {
		const config = resolveConfig(cwd);
		if (!isConfigured(config)) return null;
		const sessionKey = deriveSessionKey(cwd, sessionId);
		const handles = await createHonchoHandles({ config, sessionKey });
		const state = getState(sessionKey);
		state.handles = handles;
		return handles;
	}

	async function getRuntime(
		ctx: { cwd: string },
		sessionId: string,
	): Promise<HonchoHandles | null> {
		const sessionKey = deriveSessionKey(ctx.cwd, sessionId);
		const state = getState(sessionKey);
		if (state.handles) return state.handles;
		return bootstrap(ctx.cwd, sessionId);
	}

	async function getHandlesFromCtx(ctx: ExtensionContext): Promise<HonchoHandles | null> {
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		return getRuntime(ctx, sessionId);
	}

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		const handles = await bootstrap(ctx.cwd, sessionId);
		if (!handles) return;
		const state = getState(handles.sessionId);
		const memoryBlock = await hydrateMemoryContext(handles);
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);
	});

	pi.on("session_switch", async (_event, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.cachedPromptContext = null;
		state.lastPromptContextQuery = null;
		const memoryBlock = await hydrateMemoryContext(handles);
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return {};

		const state = getState(handles.sessionId);
		const query = (event.messages ?? [])
			.filter((m) => m.role === "user")
			.map((m) => extractTextFromMessage(m))
			.join("\n");

		let promptContext: string | null = null;
		if (query.trim() && query !== state.lastPromptContextQuery) {
			promptContext = await refreshPromptContext(handles, query);
			state.cachedPromptContext = promptContext;
			state.lastPromptContextQuery = query;
		} else {
			promptContext = state.cachedPromptContext;
		}

		const compiled = compileMemoryContext(
			await hydrateMemoryContext(handles),
			promptContext,
		);
		state.lastMemoryContext = compiled;

		if (compiled) {
			return { systemPrompt: [compiled] };
		}
		return {};
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;

		const pairs = collectMessagePairs(event.messages ?? []);
		if (pairs.length === 0) return;

		const state = getState(handles.sessionId);
		const newUserTurns = pairs.filter((p) => p.role === "user").length;

		for (const message of pairs) {
			const meta = { source: "agent_end", role: message.role };
			if (message.role === "user") {
				await saveUserMessage(handles, message.content, meta);
				const conclusion = extractDurableConclusion(message.content);
				if (conclusion) {
					const result = await saveUserConclusion(handles, conclusion);
					if (result.saved) {
						state.recentConclusions.unshift(conclusion);
						if (state.recentConclusions.length > 10) {
							state.recentConclusions.length = 10;
						}
					}
				}
			} else {
				await saveAssistantMessage(handles, message.content, meta);
			}
		}

		const toolSummary = collectToolSummary(event.messages ?? []);
		if (toolSummary) {
			await saveToolSummary(handles, toolSummary, { source: "agent_end", kind: "tool_summary" });
		}

		state.lastUserTurnCount += newUserTurns;
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.cachedPromptContext = null;

		const memoryBlock = await hydrateMemoryContext(handles);
		const continuity = formatContinuityContext(
			handles,
			state.lastMemoryContext,
			state.recentConclusions,
		);
		const compiled = compileMemoryContext(memoryBlock, continuity);
		state.lastMemoryContext = compiled;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		const sessionKey = deriveSessionKey(ctx.cwd, sessionId);
		sessions.delete(sessionKey);
	});

	registerTools(pi, { getHandles: getHandlesFromCtx });
	registerCommands(pi, { getHandles: getHandlesFromCtx });
}

