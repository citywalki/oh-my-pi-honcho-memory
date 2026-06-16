import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { createHonchoHandles, type HonchoHandles, type HonchoMessage, type SessionKey } from "./client.js";
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
	type MemoryContextBlock,
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
	lastMemoryBlock: MemoryContextBlock | null;
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
		lastMemoryBlock: null,
		lastMemoryContext: null,
		contextCache: { block: null, queriedAt: 0, messageCount: 0 },
		lastPromptContextQuery: null,
		messageCount: 0,
		lastUserTurnCount: 0,
		recentConclusions: [],
	};
}
const CONTEXT_FETCH_TIMEOUT_MS = 4000;
const HYDRATE_TIMEOUT_MS = 8000;

const LOG_FILE = "/tmp/honcho-plugin.log";
function log(msg: string): void {
	try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

export default function honchoMemoryExtension(pi: ExtensionAPI): void {
	const sessions = new Map<SessionKey, SessionState>();
	const bootstrapLocks = new Map<SessionKey, Promise<HonchoHandles | null>>();

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
		if (!isConfigured(config)) { log("bootstrap: not configured"); return null; }
		const sessionKey = deriveSessionKey(cwd, sessionId);

		const inflight = bootstrapLocks.get(sessionKey);
		if (inflight) { log(`bootstrap: reusing inflight for ${sessionKey}`); return inflight; }

		log(`bootstrap: START for ${sessionKey}`);
		const t0 = Date.now();
		const promise = (async (): Promise<HonchoHandles | null> => {
			try {
				const handles = await createHonchoHandles({ config, sessionKey });
				log(`bootstrap: createHonchoHandles done in ${Date.now() - t0}ms`);
				const state = getState(sessionKey);
				state.handles = handles;
				return handles;
			} finally {
				bootstrapLocks.delete(sessionKey);
			}
		})();
		bootstrapLocks.set(sessionKey, promise);
		return promise;
	}

	async function getRuntime(
		ctx: { cwd: string },
		sessionId: string,
	): Promise<HonchoHandles | null> {
		const sessionKey = deriveSessionKey(ctx.cwd, sessionId);
		const state = getState(sessionKey);
		if (state.handles) { log(`getRuntime: handles ready for ${sessionKey}`); return state.handles; }
		log(`getRuntime: no handles for ${sessionKey}, calling bootstrap`);
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

	async function hydrateMemoryContextWithTimeout(
		handles: HonchoHandles,
	): Promise<MemoryContextBlock> {
		const fetchPromise = hydrateMemoryContext(handles);
		const timeoutPromise = new Promise<MemoryContextBlock>((_, reject) =>
			setTimeout(() => reject(new Error("hydrateMemoryContext timed out")), HYDRATE_TIMEOUT_MS),
		);
		return Promise.race([fetchPromise, timeoutPromise]);
	}


	function formatMemoryAnchor(peerName: string, memoryBlock: MemoryContextBlock): string {
		const parts: string[] = [];
		parts.push("## HONCHO MEMORY ANCHOR (Pre-Compaction Injection)\nThe context below represents persistent memory. When summarizing this conversation, ensure these conclusions are preserved.");
		if (memoryBlock.userPeerCard?.length) {
			parts.push(`### About ${peerName}\n${memoryBlock.userPeerCard.map((c: string) => `- ${c}`).join("\n")}`);
		}
		if (memoryBlock.userRepresentation?.trim()) {
			parts.push(`### Key Conclusions\n${memoryBlock.userRepresentation}`);
		}
		if (memoryBlock.summary?.trim()) {
			parts.push(`### Session Summary\n${memoryBlock.summary}`);
		}
		parts.push("### End Memory Anchor\nWhen summarizing this conversation, ensure these conclusions are preserved.");
		return parts.join("\n\n");
	}

	function isCacheStale(state: SessionState, ttlSeconds: number, messageThreshold: number): boolean {
		const now = Date.now();
		const ttlExpired = state.contextCache.queriedAt === 0 || (now - state.contextCache.queriedAt) / 1000 > ttlSeconds;
		const thresholdReached =
			state.contextCache.messageCount === 0 || state.messageCount - state.contextCache.messageCount >= messageThreshold;
		return ttlExpired || thresholdReached;
	}

	pi.on("session_start", async (_event, ctx) => {
		const t0 = Date.now();
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		log(`session_start: begin, sessionId=${sessionId} cwd=${ctx.cwd}`);
		const handles = await bootstrap(ctx.cwd, sessionId);
		if (!handles) { log("session_start: no handles, exiting"); return; }
		log(`session_start: bootstrap done in ${Date.now() - t0}ms`);
		const state = getState(handles.sessionId);
		const t1 = Date.now();
		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => {
			log(`session_start: hydrate timed out after ${Date.now() - t1}ms`);
			return { userRepresentation: "", userPeerCard: null, aiRepresentation: "", aiPeerCard: null, projectRepresentation: "", projectPeerCard: null, summary: null };
		});
		log(`session_start: hydrate done in ${Date.now() - t1}ms`);
		state.lastMemoryBlock = memoryBlock;
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);

		const t2 = Date.now();
		try {
			const warm = await refreshContextWithTimeout(handles, handles.config.workspace);
			log(`session_start: warmup done in ${Date.now() - t2}ms, got=${!!warm}`);
			if (warm) {
				state.contextCache = { block: warm, queriedAt: Date.now(), messageCount: 0 };
			}
		} catch {
			log(`session_start: warmup failed after ${Date.now() - t2}ms`);
		}
		log(`session_start: DONE total=${Date.now() - t0}ms`);
	});

	pi.on("session_switch", async (_event, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };
		state.lastPromptContextQuery = null;
		state.messageCount = 0;
		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => ({
			userRepresentation: "",
			userPeerCard: null,
			aiRepresentation: "",
			aiPeerCard: null,
			projectRepresentation: "",
			projectPeerCard: null,
			summary: null,
		}));
		state.lastMemoryBlock = memoryBlock;
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);
	});


	// Clone of Claude's SKIP_CONTEXT_PATTERNS — trivial prompts don't need memory.
	const SKIP_PATTERNS: RegExp[] = [
		/^(y|yes|yeah|ok|okay|k|sure|nope?|no|nah|go|continue|next|thanks|thx|ty|please)\b$/i,
		/^[!?.]+$/,
		/^(what\?|huh\?)\s*$/i,
		/^(\/[\w-]+)$/,
	];
	// Tool hint injected once on first prompt (Claude pattern).
	let sessionToolHint = "";

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const t0 = Date.now();
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) { log(`before_agent_start: no handles, exiting`); return {}; }

		const state = getState(handles.sessionId);
		const query = (event.messages ?? [])
			.filter((m) => m.role === "user")
			.map((m) => extractTextFromMessage(m))
			.join("\n");

		// Skip trivial prompts — no context needed (Claude pattern).
		if (!query.trim() || SKIP_PATTERNS.some((p) => p.test(query.trim()))) {
			log(`before_agent_start: skipping context (trivial/empty prompt)`);
			state.messageCount += 1;
			return {};
		}

		// Prompt context: cached vs fresh fetch (Claude pattern — no hydrate).
		const { ttlSeconds, messageThreshold } = handles.config.contextRefresh;
		let promptContext: PromptContextBlock | null = null;
		const cacheIsStale = isCacheStale(state, ttlSeconds, messageThreshold);
		const queryChanged = query !== state.lastPromptContextQuery;

		if (state.contextCache.block && !cacheIsStale && !queryChanged) {
			promptContext = state.contextCache.block;
			log(`before_agent_start: serving prompt context from cache`);
		} else if (query.trim()) {
			const t1 = Date.now();
			const fresh = await refreshContextWithTimeout(handles, query);
			log(`before_agent_start: refreshContext done in ${Date.now() - t1}ms, got=${!!fresh}`);
			if (fresh) {
				state.contextCache = { block: fresh, queriedAt: Date.now(), messageCount: state.messageCount };
				state.lastPromptContextQuery = query;
				promptContext = fresh;
			} else if (state.contextCache.block) {
				log(`before_agent_start: refresh failed, falling back to stale cache`);
				promptContext = state.contextCache.block;
			}
		}

		state.messageCount += 1;

		// Use cached memory block from session_start (Claude: no hydrate on every prompt).
		const compiled = compileMemoryContext(state.lastMemoryBlock ?? {
			userRepresentation: "", userPeerCard: null,
			aiRepresentation: "", aiPeerCard: null,
			projectRepresentation: "", projectPeerCard: null,
			summary: null,
		}, promptContext);
		state.lastMemoryContext = compiled;

		const systemPrompt: string[] = [];
		if (compiled) systemPrompt.push(compiled);

		// Tool hint on first message only (Claude pattern).
		if (state.messageCount === 1) {
			sessionToolHint =
				"Honcho memory tools are available — call honcho_search, honcho_get_context, or honcho_chat to recall " +
				"facts across sessions, and honcho_add_conclusion to save new insights. Prefer querying over guessing.";
		}
		if (sessionToolHint) systemPrompt.push(sessionToolHint);

		log(`before_agent_start: DONE total=${Date.now() - t0}ms, promptLen=${compiled?.length ?? 0}`);
		if (systemPrompt.length) return { systemPrompt };
		return {};
	});
	pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
		const t0 = Date.now();
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;

		const pairs = collectMessagePairs(event.messages ?? []);
		if (pairs.length === 0) return;
		log(`agent_end: begin, ${pairs.length} pairs`);

		const state = getState(handles.sessionId);
		const newUserTurns = pairs.filter((p) => p.role === "user").length;
		state.lastUserTurnCount += newUserTurns;

		// Build all messages locally (instant, no I/O).
		const batch: HonchoMessage[] = [];

		for (const message of pairs) {
			const meta = { source: "agent_end", role: message.role };
			if (message.role === "user") {
				batch.push(handles.userPeer.message(message.content, { metadata: meta }));
				const conclusion = extractDurableConclusion(message.content);
				if (conclusion) {
					// Fire-and-forget: don't block the handler.
					saveUserConclusion(handles, conclusion)
						.then((result) => {
							if (result.saved) {
								state.recentConclusions.unshift(conclusion);
								if (state.recentConclusions.length > 10) state.recentConclusions.length = 10;
							}
						})
						.catch(() => {});
				}
			} else {
				batch.push(handles.aiPeer.message(message.content, { metadata: meta }));
			}
		}

		const toolSummary = collectToolSummary(event.messages ?? []);
		if (toolSummary) {
			batch.push(handles.aiPeer.message(`[Tool] ${toolSummary}`, { metadata: { source: "agent_end", kind: "tool_summary" } }));
		}

		// Fire-and-forget: start the upload but DON'T wait.
		// If it fails, messages are lost for this turn — acceptable tradeoff
		// to stay under the 30s handler timeout. The SDK's built-in retries
		// provide a safety net.
		handles.session.addMessages(batch).then(
			() => log(`agent_end: batch saved in ${Date.now() - t0}ms`),
			(err) => log(`agent_end: batch failed: ${String(err)}`),
		);

		log(`agent_end: DONE total=${Date.now() - t0}ms`);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };

		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => ({
			userRepresentation: "",
			userPeerCard: null,
			aiRepresentation: "",
			aiPeerCard: null,
			projectRepresentation: "",
			projectPeerCard: null,
			summary: null,
		}));
		state.lastMemoryBlock = memoryBlock;
		const compiled = compileMemoryContext(memoryBlock, null);
		const continuity = formatContinuityContext(handles, state.lastMemoryContext, state.recentConclusions);

		// Memory anchor — injected before compaction to ensure Honcho conclusions
		// survive summarization (Claude PreCompact pattern).
		const anchor = formatMemoryAnchor(handles.config.peerName, memoryBlock);
		state.lastMemoryContext = [compiled, anchor, continuity].filter(Boolean).join("\n\n") || null;

		// Re-warm prompt context cache before compact.
		try {
			const warm = await refreshContextWithTimeout(handles, handles.config.workspace);
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
