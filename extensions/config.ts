import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type HonchoSessionStrategy =
	| "per-repo"
	| "per-directory"
	| "per-session"
	| "global";

export type HonchoObservationMode = "unified" | "directional";

export interface HonchoExtensionConfig {
	enabled: boolean;
	url: string;
	apiKey: string;
	workspace: string;
	peerName: string;
	aiPeer: string;
	sessionStrategy: HonchoSessionStrategy;
	observationMode: HonchoObservationMode;
	contextTokens: number;
	commitEveryNTurns: number;
	contextRefresh: {
		messageThreshold: number;
		ttlSeconds: number;
	};
}

const DEFAULTS: HonchoExtensionConfig = {
	enabled: false,
	url: "https://api.honcho.dev",
	apiKey: "",
	workspace: "oh-my-pi",
	peerName: "user",
	aiPeer: "ai-oh-my-pi",
	sessionStrategy: "per-repo",
	observationMode: "unified",
	contextTokens: 1200,
	commitEveryNTurns: 4,
	contextRefresh: {
		messageThreshold: 30,
		ttlSeconds: 300,
	},
};

function expandEnv(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => process.env[key] ?? "");
}

function normalizePeerName(name: string): string {
	const trimmed = name.trim().toLowerCase();
	const noPrefix = trimmed.replace(/^(user-|project-|ai-)/, "");
	return noPrefix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "user";
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const result: Partial<T> = {};
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (value !== undefined) {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}
const DEFAULT_HOST = "omp";
// ============================================
// Config file: ~/.honcho/config.json
// Following the official claude-honcho / pi-honcho-memory pattern
// ============================================

function honchoConfigPath(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
	return join(home, ".honcho", "config.json");
}


/** Per-host / per-directory overrides within config.json */
interface HonchoScopeConfig {
	apiKey?: string;
	url?: string;
	workspace?: string;
	aiPeer?: string;
	sessionStrategy?: HonchoSessionStrategy;
	observationMode?: HonchoObservationMode;
	contextTokens?: number;
	commitEveryNTurns?: number;
	contextRefresh?: {
		messageThreshold?: number;
		ttlSeconds?: number;
	};
}

/** Raw shape of ~/.honcho/config.json on disk */
interface HonchoFileConfig {
	enabled?: boolean;
	apiKey?: string;
	peerName?: string;
	url?: string;
	workspace?: string;
	aiPeer?: string;
	sessionStrategy?: HonchoSessionStrategy;
	observationMode?: HonchoObservationMode;
	contextTokens?: number;
	commitEveryNTurns?: number;
	contextRefresh?: {
		messageThreshold?: number;
		ttlSeconds?: number;
	};
	hosts?: Record<string, HonchoScopeConfig>;
	/** Per-directory overrides — longest prefix match of absolute path wins */
	directories?: Record<string, HonchoScopeConfig>;
}

function readHonchoConfig(): HonchoFileConfig {
	if (!existsSync(honchoConfigPath())) return {};
	try {
		const text = readFileSync(honchoConfigPath(), "utf8");
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as HonchoFileConfig;
		}
	} catch {}
	return {};
}

/**
 * Find the best matching directory entry for cwd.
 * Longest absolute-path prefix that is an ancestor of cwd wins.
 */
function matchDirectory(
	cwd: string,
	directories: Record<string, HonchoScopeConfig>,
): HonchoScopeConfig {
	const resolvedCwd = resolve(cwd);
	let bestMatch: { config: HonchoScopeConfig; path: string } | null = null;

	for (const [key, config] of Object.entries(directories)) {
		const resolvedKey = resolve(key);
		if (!resolvedCwd.startsWith(resolvedKey)) continue;
		// Must be an exact match or a directory boundary (followed by /)
		if (resolvedCwd.length > resolvedKey.length && resolvedCwd[resolvedKey.length] !== "/") continue;
		if (!bestMatch || resolvedKey.length > bestMatch.path.length) {
			bestMatch = { config, path: resolvedKey };
		}
	}

	return bestMatch?.config ?? {};
}

function honchoConfigToPartial(config: HonchoScopeConfig): Partial<HonchoExtensionConfig> {
	const result: Partial<HonchoExtensionConfig> = stripUndefined({
		apiKey: config.apiKey,
		url: config.url,
		workspace: config.workspace,
		aiPeer: config.aiPeer,
		sessionStrategy: config.sessionStrategy,
		observationMode: config.observationMode,
		contextTokens: config.contextTokens,
		commitEveryNTurns: config.commitEveryNTurns,
	});
	if (config.contextRefresh) {
		result.contextRefresh = {
			messageThreshold: config.contextRefresh.messageThreshold ?? DEFAULTS.contextRefresh.messageThreshold,
			ttlSeconds: config.contextRefresh.ttlSeconds ?? DEFAULTS.contextRefresh.ttlSeconds,
		};
	}
	return result;
}

// ============================================
// Resolve
// ============================================

export function resolveConfig(cwd: string): HonchoExtensionConfig {
	const honchoFile = readHonchoConfig();
	const hostScoped = honchoFile.hosts?.[DEFAULT_HOST] ?? {};
	const dirScoped = matchDirectory(cwd, honchoFile.directories ?? {});

	const envHoncho: Partial<HonchoExtensionConfig> = stripUndefined({
		apiKey: process.env.HONCHO_API_KEY,
		url: process.env.HONCHO_URL,
		workspace: process.env.HONCHO_WORKSPACE,
		peerName: process.env.HONCHO_PEER_NAME ?? process.env.HONCHO_USERNAME,
		aiPeer: process.env.HONCHO_AI_PEER,
	});

	// Merge: later sources override earlier ones
	const merged = {
		...DEFAULTS,
		// Config file global fields
		...stripUndefined({
			enabled: honchoFile.enabled,
			apiKey: honchoFile.apiKey,
			peerName: honchoFile.peerName,
			url: honchoFile.url,
			workspace: honchoFile.workspace,
			aiPeer: honchoFile.aiPeer,
			sessionStrategy: honchoFile.sessionStrategy,
			observationMode: honchoFile.observationMode,
			contextTokens: honchoFile.contextTokens,
			commitEveryNTurns: honchoFile.commitEveryNTurns,
			contextRefresh: honchoFile.contextRefresh,
		}),
		// Config file hosts.omp block
		...honchoConfigToPartial(hostScoped),
		// Config file directories block
		...honchoConfigToPartial(dirScoped),
		// Environment variables (highest precedence)
		...envHoncho,
	};

	if (merged.apiKey) merged.apiKey = expandEnv(merged.apiKey);
	if (merged.url) merged.url = expandEnv(merged.url);

	merged.peerName = normalizePeerName(merged.peerName);

	return merged as HonchoExtensionConfig;
}

export function isConfigured(config: HonchoExtensionConfig): boolean {
	return Boolean(config.enabled && config.apiKey && config.workspace);
}
