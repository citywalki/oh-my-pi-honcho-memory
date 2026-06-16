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
	type PromptContextBlock,
	type ContextCache,
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
	contextCache: ContextCache;
	lastPromptContextQuery: string | null;
	messageCount: number;
	lastUserTurnCount: number;
	recentConclusions: string[];
}

function createSessionState(): SessionState {
	return {
		handles: null,
		lastMemoryContext: null,
		contextCache: { block: null, queriedAt: 0, messageCount: 0 },
		lastPromptContextQuery: null,
		messageCount: 0,
		lastUserTurnCount: 0,
		recentConclusions: [],
	};
}

const CONTEXT_FETCH_TIMEOUT_MS = 4000;

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

	async function fetchPromptContext(
		handles: HonchoHandles,
		query: string,
	): Promise<PromptContextBlock | null> {
		return refreshPromptContext(handles, query, handles.config.observationMode);
	}

	async function refreshContextWithTimeout(
		handles: HonchoHandles,
		query: string,
	): Promise<PromptContextBlock | null> {
		const fetchPromise = fetchPromptContext(handles, query).then((block) => ({ ok: true as const, block }));
		const timeoutPromise = new Promise<{ ok: false }>((resolve) =>
			setTimeout(() => resolve({ ok: false }), CONTEXT_FETCH_TIMEOUT_MS),
		);
		const result = await Promise.race([fetchPromise, timeoutPromise]).catch((): { ok: false } => ({ ok: false }));
		return result.ok ? result.block : null;
	}

	function isCacheStale(state: SessionState, ttlSeconds: number, messageThreshold: number): boolean {
		const now = Date.now();
		const ttlExpired = state.contextCache.queriedAt === 0 || (now - state.contextCache.queriedAt) / 1000 > ttlSeconds;
		const thresholdReached =
			state.contextCache.messageCount === 0 || state.messageCount - state.contextCache.messageCount >= messageThreshold;
		return ttlExpired || thresholdReached;
	}

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		const handles = await bootstrap(ctx.cwd, sessionId);
		if (!handles) return;
		const state = getState(handles.sessionId);
		const memoryBlock = await hydrateMemoryContext(handles);
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);

		// Warm prompt context cache with a neutral workspace query.
		try {
			const warm = await fetchPromptContext(handles, handles.config.workspace);
			if (warm) {
				state.contextCache = {
					block: warm,
					queriedAt: Date.now(),
					messageCount: 0,
				};
			}
		} catch {
			// Warm-up failure is non-fatal; context will be fetched on first prompt.
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };
		state.lastPromptContextQuery = null;
		state.messageCount = 0;
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

		const { ttlSeconds, messageThreshold } = handles.config.contextRefresh;
		let promptContext: PromptContextBlock | null = null;
		const cacheIsStale = isCacheStale(state, ttlSeconds, messageThreshold);
		const queryChanged = query.trim() && query !== state.lastPromptContextQuery;

		if (state.contextCache.block && !cacheIsStale && !queryChanged) {
			// Fresh cache — serve instantly.
			promptContext = state.contextCache.block;
		} else if (query.trim()) {
			// Try a fresh fetch with timeout.
			const fresh = await refreshContextWithTimeout(handles, query);
			if (fresh) {
				state.contextCache = {
					block: fresh,
					queriedAt: Date.now(),
					messageCount: state.messageCount,
				};
				state.lastPromptContextQuery = query;
				promptContext = fresh;
			} else if (state.contextCache.block) {
				// Fetch failed or timed out — fall back to stale cache.
				promptContext = state.contextCache.block;
			}
		} else {
			promptContext = state.contextCache.block;
		}

		state.messageCount += 1;

		const compiled = compileMemoryContext(await hydrateMemoryContext(handles), promptContext);
		state.lastMemoryContext = compiled;

		const systemPrompt: string[] = [];
		if (compiled) systemPrompt.push(compiled);

		// First prompt of the session: nudge active use of Honcho tools.
		if (state.messageCount === 1) {
			systemPrompt.push(
				"Honcho memory tools are available — call honcho_search, honcho_get_context, or honcho_chat to recall " +
					"facts across sessions, and honcho_add_conclusion to save new insights.",
			);
		}

		if (systemPrompt.length) {
			return { systemPrompt };
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
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };

		const memoryBlock = await hydrateMemoryContext(handles);
		const compiled = compileMemoryContext(memoryBlock, null);
		const continuity = formatContinuityContext(handles, state.lastMemoryContext, state.recentConclusions);
		state.lastMemoryContext = [compiled, continuity].filter(Boolean).join("\n\n") || null;

		// Re-warm prompt context cache before compact.
		try {
			const warm = await fetchPromptContext(handles, handles.config.workspace);
			if (warm) {
				state.contextCache = {
					block: warm,
					queriedAt: Date.now(),
					messageCount: state.messageCount,
				};
			}
		} catch {
			// Re-warm failure is non-fatal.
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		const sessionKey = deriveSessionKey(ctx.cwd, sessionId);
		sessions.delete(sessionKey);
	});

	registerTools(pi, { getHandles: getHandlesFromCtx });
	registerCommands(pi, { getHandles: getHandlesFromCtx });
}
