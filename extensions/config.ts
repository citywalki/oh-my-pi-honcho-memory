import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";

export type HonchoSessionStrategy =
	| "per-repo"
	| "per-directory"
	| "per-session"
	| "global";

export interface HonchoExtensionConfig {
	enabled: boolean;
	url: string;
	apiKey: string;
	workspace: string;
	peerName: string;
	aiPeer: string;
	projectPeer: string | null;
	sessionStrategy: HonchoSessionStrategy;
	contextTokens: number;
	commitEveryNTurns: number;
}

const DEFAULTS: HonchoExtensionConfig = {
	enabled: true,
	url: "https://api.honcho.dev",
	apiKey: "",
	workspace: "oh-my-pi",
	peerName: "user",
	aiPeer: "ai-oh-my-pi",
	projectPeer: null,
	sessionStrategy: "per-repo",
	contextTokens: 1200,
	commitEveryNTurns: 4,
};

function readYaml(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const text = readFileSync(path, "utf8");
		return (yaml.load(text) as Record<string, unknown>) ?? {};
	} catch {
		return {};
	}
}

function pickHoncho(raw: Record<string, unknown>): Partial<HonchoExtensionConfig> {
	const honcho = raw.honcho;
	if (!honcho || typeof honcho !== "object") return {};
	return honcho as Partial<HonchoExtensionConfig>;
}

function expandEnv(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => process.env[key] ?? "");
}

function normalizePeerName(name: string): string {
	const trimmed = name.trim().toLowerCase();
	const noPrefix = trimmed.replace(/^(user-|project-|ai-)/, "");
	return noPrefix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "user";
}

function userConfigPath(): string {
	return join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".omp", "agent", "config.yml");
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

export function resolveConfig(cwd: string): HonchoExtensionConfig {
	const globalRaw = readYaml(userConfigPath());
	const projectRaw = readYaml(resolve(cwd, ".omp", "config.yml"));

	const globalHoncho = pickHoncho(globalRaw);
	const projectHoncho = pickHoncho(projectRaw);

	const envHoncho: Partial<HonchoExtensionConfig> = stripUndefined({
		apiKey: process.env.HONCHO_API_KEY,
		url: process.env.HONCHO_URL,
		workspace: process.env.HONCHO_WORKSPACE,
		peerName: process.env.HONCHO_PEER_NAME ?? process.env.HONCHO_USERNAME,
		aiPeer: process.env.HONCHO_AI_PEER,
		projectPeer: process.env.HONCHO_PROJECT_PEER,
	});

	const merged: HonchoExtensionConfig = {
		...DEFAULTS,
		...globalHoncho,
		...projectHoncho,
		...envHoncho,
	};

	if (merged.apiKey) merged.apiKey = expandEnv(merged.apiKey);
	if (merged.url) merged.url = expandEnv(merged.url);

	const legacyUsername = (merged as unknown as Record<string, unknown>).username as string | undefined;
	merged.peerName = normalizePeerName(merged.peerName || legacyUsername || "");
	if (merged.projectPeer) merged.projectPeer = normalizePeerName(merged.projectPeer);

	return merged;
}

export function isConfigured(config: HonchoExtensionConfig): boolean {
	return Boolean(config.enabled && config.apiKey && config.workspace);
}
