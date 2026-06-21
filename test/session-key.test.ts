import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { buildSessionKey, sanitizeForSessionName, deriveGitBranchLabel } from "../extensions/session-key.js";

describe("sanitizeForSessionName", () => {
	it("lower-cases and replaces invalid characters with hyphens", () => {
		expect(sanitizeForSessionName("Feature/Branch_123")).toBe("feature-branch_123");
		expect(sanitizeForSessionName("___")).toBe("___");
	});
});

describe("buildSessionKey", () => {
	const base = {
		cwd: "/home/user/project",
		sessionId: "sess-123",
		peerName: "Alice",
		sessionPeerPrefix: true,
	};

	it("builds per-directory key with peer prefix", () => {
		const key = buildSessionKey({ ...base, sessionStrategy: "per-directory" });
		expect(key).toBe("alice-project");
	});

	it("builds per-directory key without peer prefix", () => {
		const key = buildSessionKey({ ...base, sessionPeerPrefix: false, sessionStrategy: "per-directory" });
		expect(key).toBe("project");
	});

	it("builds chat-instance key with peer prefix", () => {
		const key = buildSessionKey({ ...base, sessionStrategy: "chat-instance" });
		expect(key).toBe("alice-chat-sess-123");
	});

	it("builds chat-instance key without peer prefix", () => {
		const key = buildSessionKey({ ...base, sessionPeerPrefix: false, sessionStrategy: "chat-instance" });
		expect(key).toBe("chat-sess-123");
	});

	it("builds git-branch key when branch is available", () => {
		const spy = spyOn(childProcess, "execSync");
		spy.mockReturnValue("feature-x\n" as never);
		try {
			const key = buildSessionKey({ ...base, sessionStrategy: "git-branch" });
			expect(key).toBe("alice-project-feature-x");
		} finally {
			spy.mockRestore();
		}
	});

	it("falls back to per-directory style when git branch cannot be read", () => {
		const spy = spyOn(childProcess, "execSync");
		spy.mockImplementation(() => {
			throw new Error("not a git repo");
		});
		try {
			const key = buildSessionKey({ ...base, sessionStrategy: "git-branch" });
			expect(key).toBe("alice-project");
		} finally {
			spy.mockRestore();
		}
	});
});

describe("deriveGitBranchLabel", () => {
	it("trims the branch output", () => {
		const spy = spyOn(childProcess, "execSync");
		spy.mockReturnValue("  main  \n");
		try {
			expect(deriveGitBranchLabel("/tmp")).toBe("main");
		} finally {
			spy.mockRestore();
		}
	});

	it("returns null when git fails", () => {
		const spy = spyOn(childProcess, "execSync");
		spy.mockImplementation(() => {
			throw new Error("not a git repo");
		});
		try {
			expect(deriveGitBranchLabel("/tmp")).toBeNull();
		} finally {
			spy.mockRestore();
		}
	});
});
