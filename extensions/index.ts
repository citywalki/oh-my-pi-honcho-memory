import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { createHonchoHandles, type HonchoHandles, type HonchoMessage, type SessionKey } from "./client.js";
import { resolveConfig, isConfigured, getSessionOverride } from "./config.js";
import {
	compileMemoryContext,
	flushPending,
	hydrateMemoryContext,
	queueMessageBatch,
	refreshPromptContext,
	saveUserConclusion,
	formatContinuityContext,
	parseObservationLines,
	formatPeerCardCompact,
	type PromptContextBlock,
	type ContextCache,
	type MemoryContextBlock,
} from "./memory.js";
import {
	collectMessagePairs,
	collectToolSummary,
	extractDurableConclusion,
	maybeTruncateContent,
} from "./message-utils.js";
import { buildSessionKey } from "./session-key.js";
import { registerTools } from "./tools.js";
import { registerCommands } from "./commands.js";

interface SessionState {
	handles: HonchoHandles | null;
	lastMemoryBlock: MemoryContextBlock | null;
	lastMemoryContext: string | null;
	contextCache: ContextCache;
	lastPromptContextQuery: string | null;
	messageCount: number;
	lastUserTurnCount: number;
	recentConclusions: string[];
	/** Set to true after session_start finishes loading memory */
	memoryReady: boolean;
	/** Track last batch size to detect duplicate agent_end calls */
	lastAgentEndBatchSize: number;
	/** Cached git state for this session */
	gitState: import("./git.js").GitState | null;
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
		memoryReady: false,
		lastAgentEndBatchSize: -1,
		gitState: null,
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

	function setStatus(ctx: ExtensionContext, state: "off" | "connected" | "syncing" | "offline" | "error" | undefined): void {
		const labels: Record<string, string> = {
			off: "off",
			connected: "connected",
			syncing: "syncing",
			offline: "offline",
			error: "error",
		};
		ctx.ui.setStatus("honcho", state ? labels[state] : undefined);
	}
	function getState(sessionKey: SessionKey): SessionState {
		let state = sessions.get(sessionKey);
		if (!state) {
			state = createSessionState();
			sessions.set(sessionKey, state);
		}
		return state;
	}
	function deriveSessionKey(cwd: string, sessionId: string): SessionKey {
		const config = resolveConfig(cwd);
		return buildSessionKey({
			sessionStrategy: config.sessionStrategy,
			sessionPeerPrefix: config.sessionPeerPrefix,
			peerName: config.peerName,
			cwd,
			sessionId,
			sessions: getSessionOverride(cwd) ? { [cwd]: getSessionOverride(cwd)! } : undefined,
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

		const userObs = parseObservationLines(memoryBlock.userRepresentation);
		const userCard = formatPeerCardCompact(memoryBlock.userPeerCard);
		if (userObs.length > 0 || userCard) {
			parts.push(`### About ${peerName}\n${userObs.join("\n")}${userCard ? `\n\nKey: ${userCard}` : ""}`);
		}
		if (memoryBlock.aiRepresentation?.trim()) {
			const aiObs = parseObservationLines(memoryBlock.aiRepresentation);
			if (aiObs.length > 0) parts.push(`### AI Context\n${aiObs.slice(0, 8).join("\n")}`);
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
		setStatus(ctx, "syncing");
		const handles = await bootstrap(ctx.cwd, sessionId);
		if (!handles) {
			log("session_start: no handles, exiting");
			setStatus(ctx, undefined);
			return;
		}
		log(`session_start: bootstrap done in ${Date.now() - t0}ms`);
		setStatus(ctx, "connected");
		const state = getState(handles.sessionId);

		// Capture git state and detect external changes (Claude pattern).
		const { captureGitState, detectGitChanges, getRecentCommits, isGitRepo, inferFeatureContext } = await import("./git.js");
		const previousGitState = state.gitState;
		const currentGitState = captureGitState(ctx.cwd);
		const gitChanges = currentGitState ? detectGitChanges(previousGitState, currentGitState) : [];
		const recentCommits = isGitRepo(ctx.cwd) ? getRecentCommits(ctx.cwd, 5) : [];
		const featureContext = currentGitState ? inferFeatureContext(currentGitState, recentCommits) : null;
		if (currentGitState) {
			state.gitState = currentGitState;
		}

		// Upload git changes as observations (fire-and-forget).
		const externalGitChanges = gitChanges.filter((c) => c.type !== "initial");
		if (externalGitChanges.length > 0) {
			const messages = externalGitChanges.map((change) =>
				handles.userPeer.message(`[Git External] ${change.description}`, {
					metadata: {
						type: "git_change",
						change_type: change.type,
						from: change.from,
						to: change.to,
						external: true,
					},
				}),
			);
			handles.session.addMessages(messages).catch((err) => log(`session_start: git observations failed: ${String(err)}`));
		}

		const t1 = Date.now();
		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => {
			log(`session_start: hydrate timed out after ${Date.now() - t1}ms`);
			return { userPeerName: "", userRepresentation: "", userPeerCard: null, aiPeerName: "", aiRepresentation: "", aiPeerCard: null, summary: null };
		});
		log(`session_start: hydrate done in ${Date.now() - t1}ms`);
		state.memoryReady = true;

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

		// Fire-and-forget dialectic queries to warm the knowledge graph (Claude pattern).
		const branchContext = currentGitState ? ` on branch '${currentGitState.branch}'` : "";
		const featureHint = featureContext && featureContext.confidence !== "low"
			? ` Working on: ${featureContext.type} - ${featureContext.description}.`
			: "";
		const dialecticLevel = handles.config.reasoningLevel;
		try {
			if (handles.config.observationMode === "unified") {
				handles.userPeer.chat(
					`Summarize what you know about ${handles.config.peerName}. Focus on preferences, current projects, and working style.${branchContext}${featureHint}`,
					{ session: handles.session, reasoningLevel: dialecticLevel },
				).catch((err) => log(`session_start: dialectic user failed: ${String(err)}`));
				handles.userPeer.chat(
					`What has ${handles.config.peerName} been working on recently?${branchContext}${featureHint} Summarize recent activities relevant to the current work.`,
					{ session: handles.session, reasoningLevel: dialecticLevel },
				).catch((err) => log(`session_start: dialectic recent failed: ${String(err)}`));
			} else {
				handles.aiPeer.chat(
					`Summarize what you know about ${handles.config.peerName}. Focus on preferences, current projects, and working style.${branchContext}${featureHint}`,
					{ target: handles.userPeer, session: handles.session, reasoningLevel: dialecticLevel },
				).catch((err) => log(`session_start: dialectic user failed: ${String(err)}`));
				handles.aiPeer.chat(
					`What has ${handles.config.peerName} been working on recently?${branchContext}${featureHint} Summarize recent activities relevant to the current work.`,
					{ target: handles.userPeer, session: handles.session, reasoningLevel: dialecticLevel },
				).catch((err) => log(`session_start: dialectic recent failed: ${String(err)}`));
			}
		} catch {
			// Non-fatal: dialectic warmup is best-effort.
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		// Drain any queued uploads from the previous session before switching.
		await flushPending().catch(() => {});
		setStatus(ctx, "syncing");
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) {
			setStatus(ctx, undefined);
			return;
		}
		const state = getState(handles.sessionId);
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };
		state.lastPromptContextQuery = null;
		state.messageCount = 0;
		state.lastAgentEndBatchSize = -1;
		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => ({
			userPeerName: "",
			userRepresentation: "",
			userPeerCard: null,
			aiPeerName: "",
			aiRepresentation: "",
			aiPeerCard: null,
			summary: null,
		}));
		state.lastMemoryBlock = memoryBlock;
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);
		state.memoryReady = true;
		setStatus(ctx, "connected");
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

	/**
	 * Ensure memory has been hydrated before using it.
	 * If session_start hasn't finished yet, hydrate now (blocking).
	 */
	async function ensureMemoryReady(
		state: SessionState,
		handles: HonchoHandles,
	): Promise<MemoryContextBlock> {
		if (state.memoryReady && state.lastMemoryBlock) {
			return state.lastMemoryBlock;
		}
		log(`ensureMemoryReady: memory not ready, hydrating now`);
		const t0 = Date.now();
		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => {
			log(`ensureMemoryReady: hydrate timed out after ${Date.now() - t0}ms`);
			return {
				userPeerName: "", userRepresentation: "", userPeerCard: null,
				aiPeerName: "", aiRepresentation: "", aiPeerCard: null,
				summary: null,
			};
		});
		log(`ensureMemoryReady: hydrate done in ${Date.now() - t0}ms`);
		state.lastMemoryBlock = memoryBlock;
		state.lastMemoryContext = compileMemoryContext(memoryBlock, null);
		state.memoryReady = true;
		return memoryBlock;
	}
	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const t0 = Date.now();
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) { log(`before_agent_start: no handles, exiting`); return {}; }

		const state = getState(handles.sessionId);
		state.messageCount += 1;

		// Use event.prompt (the raw user input) for semantic search.
		const query = event.prompt ?? "";
		const hasQuery = query.trim().length > 0 && !SKIP_PATTERNS.some((p) => p.test(query.trim()));

		// Prompt context: cached vs fresh fetch (only when meaningful query available).
		const { ttlSeconds, messageThreshold } = handles.config.contextRefresh;
		let promptContext: PromptContextBlock | null = null;

		if (hasQuery) {
			const cacheIsStale = isCacheStale(state, ttlSeconds, messageThreshold);
			const queryChanged = query !== state.lastPromptContextQuery;

			if (state.contextCache.block && !cacheIsStale && !queryChanged) {
				promptContext = state.contextCache.block;
				log(`before_agent_start: serving prompt context from cache`);
			} else {
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
		}

		// Always compile memory context from session_start cache.
		// Ensure memory is ready before compiling context.
		// session_start may not have finished yet if this fires first.
		const memoryBlock = await ensureMemoryReady(state, handles);

		// Compile memory context.
		const compiled = compileMemoryContext(memoryBlock, promptContext);
		state.lastMemoryContext = compiled;

		// Append to existing system prompt (do NOT replace it — harness base prompt must stay).
		const systemPrompt = [...event.systemPrompt];
		if (compiled) systemPrompt.push(compiled);

		// Tool hint on first message only (Claude pattern).
		if (state.messageCount === 1) {
			sessionToolHint =
				"Honcho memory tools are available — call honcho_search, honcho_get_context, or honcho_chat to recall " +
				"facts across sessions, and honcho_add_conclusion to save new insights. Prefer querying over guessing.";
		}
		if (sessionToolHint) systemPrompt.push(sessionToolHint);

		log(`before_agent_start: DONE total=${Date.now() - t0}ms, promptLen=${systemPrompt.length}, hasQuery=${hasQuery}`);
		return { systemPrompt };
	});
	pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
		const t0 = Date.now();
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		setStatus(ctx, "syncing");

		const pairs = collectMessagePairs(event.messages ?? []);
		if (pairs.length === 0) {
			setStatus(ctx, "connected");
			return;
		}

		const state = getState(handles.sessionId);

		// Deduplicate: agent_end can fire twice for the same turn.
		// Skip if the batch size matches the last one we just saved.
		if (pairs.length === state.lastAgentEndBatchSize) {
			log(`agent_end: skipping duplicate, same batch size ${pairs.length}`);
			return;
		}
		state.lastAgentEndBatchSize = pairs.length;

		log(`agent_end: begin, ${pairs.length} pairs`);
		const newUserTurns = pairs.filter((p) => p.role === "user").length;
		state.lastUserTurnCount += newUserTurns;

		// Build all messages locally (instant, no I/O).
		const batch: HonchoMessage[] = [];
		const userUploadConfig = {
			maxTokens: handles.config.messageUpload.maxUserTokens,
		};
		const assistantUploadConfig = {
			maxTokens: handles.config.messageUpload.maxAssistantTokens,
			summarize: handles.config.messageUpload.summarizeAssistant,
		};

		for (const message of pairs) {
			if (message.role === "user") {
				const content = maybeTruncateContent(message.content, userUploadConfig);
				batch.push(handles.userPeer.message(content));
				const conclusion = extractDurableConclusion(content);
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
				const content = maybeTruncateContent(message.content, assistantUploadConfig);
				batch.push(handles.aiPeer.message(content));
			}
		}

		// Enqueue upload so concurrent agent_end events do not issue parallel
		// addMessages calls. Lifecycle boundaries call flushPending() to drain.
		if (handles.config.saveMessages !== false) {
			queueMessageBatch(handles, batch).then(
				() => {
					log(`agent_end: batch saved in ${Date.now() - t0}ms`);
					setStatus(ctx, "connected");
				},
				(err: unknown) => {
					log(`agent_end: batch failed: ${String(err)}`);
					setStatus(ctx, "offline");
				},
			);
		} else {
			log(`agent_end: saveMessages disabled, skipping batch upload`);
			setStatus(ctx, "connected");
		}

		log(`agent_end: DONE total=${Date.now() - t0}ms`);
	});
	pi.on("session_before_compact", async (_event, ctx) => {
		// Ensure all pending message uploads complete before compaction runs.
		await flushPending().catch(() => {});
		const handles = await getHandlesFromCtx(ctx);
		if (!handles) return;
		const state = getState(handles.sessionId);
		state.contextCache = { block: null, queriedAt: 0, messageCount: 0 };
		state.lastAgentEndBatchSize = -1;

		const memoryBlock = await hydrateMemoryContextWithTimeout(handles).catch(() => ({
			userPeerName: "",
			userRepresentation: "",
			userPeerCard: null,
			aiPeerName: "",
			aiRepresentation: "",
			aiPeerCard: null,
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
		// Drain queued uploads before the session goes away. oh-my-pi caps this
		// handler at 2s, so the flush is awaited but bounded by the host timeout.
		await flushPending().catch(() => {});
		setStatus(ctx, "off");
		const handles = await getHandlesFromCtx(ctx).catch(() => null);
		if (handles) {
			// Best-effort session-end marker; do not await because oh-my-pi
			// imposes a 2s handler timeout for this event.
			const marker = handles.aiPeer.message(`[Session ended]`, {
				metadata: { type: "session_end_marker" },
			});
			handles.session
				.addMessages([marker])
				.then(
					() => log(`session_shutdown: end marker uploaded`),
					(err: unknown) => log(`session_shutdown: end marker failed: ${String(err)}`),
				);
		}
		const sessionId = ctx.sessionManager.sessionId ?? "default";
		const sessionKey = deriveSessionKey(ctx.cwd, sessionId);
		sessions.delete(sessionKey);
	});

	registerTools(pi, { getHandles: getHandlesFromCtx });
	registerCommands(pi, { getHandles: getHandlesFromCtx });
}
