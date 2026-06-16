import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execSync } from "node:child_process";
import type { HonchoSessionStrategy } from "./config.js";

export function deriveSessionScope(params: {
	sessionStrategy: HonchoSessionStrategy;
	rootDir: string;
	repoName: string;
	currentDirectory: string;
	sessionId: string;
}): string {
	switch (params.sessionStrategy) {
		case "per-session":
			return params.sessionId;
		case "per-directory":
			return params.currentDirectory;
		case "per-repo":
			return params.repoName || params.rootDir;
		case "global":
			return "global";
		default:
			return params.repoName || params.rootDir;
	}
}

export function deriveGitBranchLabel(rootDir: string): string | null {
	try {
		const result = execSync("git branch --show-current", {
			cwd: rootDir,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		return result.trim();
	} catch {
		return null;
	}
}

export function deriveProjectRoot(cwd: string): string {
	let dir = cwd;
	for (let i = 0; i < 32; i++) {
		if (
			existsSync(join(dir, ".git")) ||
			existsSync(join(dir, ".omp")) ||
			existsSync(join(dir, "package.json"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return cwd;
}

function normalizeId(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "default";
}

export function buildSessionKey(params: {
	sessionStrategy: HonchoSessionStrategy;
	rootDir: string;
	cwd: string;
	sessionId: string;
}): string {
	const repoName = basename(params.rootDir);
	const scope = deriveSessionScope({
		sessionStrategy: params.sessionStrategy,
		rootDir: params.rootDir,
		repoName,
		currentDirectory: params.cwd,
		sessionId: params.sessionId,
	});
	return normalizeId(`${params.sessionStrategy}:${scope}`);
}
