import { describe, expect, it } from "bun:test";
import { deriveSessionScope, deriveProjectRoot, buildSessionKey } from "../extensions/session-key.js";

describe("deriveSessionScope", () => {
	const base = {
		rootDir: "/home/user/project",
		repoName: "project",
		currentDirectory: "/home/user/project/src",
		sessionId: "sess-123",
	};

	it("uses sessionId for per-session", () => {
		expect(deriveSessionScope({ ...base, sessionStrategy: "per-session" })).toBe("sess-123");
	});

	it("uses current directory for per-directory", () => {
		expect(deriveSessionScope({ ...base, sessionStrategy: "per-directory" })).toBe("/home/user/project/src");
	});

	it("uses repo name for per-repo", () => {
		expect(deriveSessionScope({ ...base, sessionStrategy: "per-repo" })).toBe("project");
	});

	it("falls back to rootDir when repo name is empty", () => {
		expect(deriveSessionScope({ ...base, repoName: "", sessionStrategy: "per-repo" })).toBe("/home/user/project");
	});

	it("returns global for global strategy", () => {
		expect(deriveSessionScope({ ...base, sessionStrategy: "global" })).toBe("global");
	});
});

describe("deriveProjectRoot", () => {
	it("finds project root from a nested path", () => {
		const root = deriveProjectRoot(import.meta.dir);
		expect(root).toBe(import.meta.dir.split("/test")[0]);
	});
});

describe("buildSessionKey", () => {
	it("builds normalized per-repo key", () => {
		const key = buildSessionKey({
			sessionStrategy: "per-repo",
			rootDir: "/home/user/My Project",
			cwd: "/home/user/My Project/src",
			sessionId: "sess-123",
		});
		expect(key).toBe("per-repo-my-project");
	});

	it("builds per-session key", () => {
		const key = buildSessionKey({
			sessionStrategy: "per-session",
			rootDir: "/home/user/project",
			cwd: "/home/user/project",
			sessionId: "abc-123",
		});
		expect(key).toBe("per-session-abc-123");
	});

	it("builds global key", () => {
		const key = buildSessionKey({
			sessionStrategy: "global",
			rootDir: "/home/user/project",
			cwd: "/home/user/project",
			sessionId: "abc-123",
		});
		expect(key).toBe("global-global");
	});
});
