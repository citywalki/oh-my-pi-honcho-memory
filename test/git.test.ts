import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import {
	captureGitState,
	getRecentCommits,
	detectGitChanges,
	inferFeatureContext,
} from "../extensions/git.js";

const GIT_REPO_CWD = "/tmp/honcho-git-test";

describe("git state capture", () => {
	it("returns null when cwd is not a git repo", () => {
		const fsSpy = spyOn(fs, "existsSync");
		fsSpy.mockReturnValue(false);
		try {
			expect(captureGitState("/tmp/nonexistent")).toBeNull();
		} finally {
			fsSpy.mockRestore();
		}
	});

	it("captures branch, commit and dirty files", () => {
		const fsSpy = spyOn(fs, "existsSync");
		fsSpy.mockReturnValue(true);
		let callIndex = 0;
		const responses = ["feature-x", "abc1234", "feat: add thing", " M src/file.ts\n?? other.txt"];
		const spy = spyOn(childProcess, "execSync");
		spy.mockImplementation(() => responses[callIndex++] as never);
		try {
			const state = captureGitState(GIT_REPO_CWD);
			expect(state).not.toBeNull();
			expect(state?.branch).toBe("feature-x");
			expect(state?.commit).toBe("abc1234");
			expect(state?.commitMessage).toBe("feat: add thing");
			expect(state?.isDirty).toBe(true);
			expect(state?.dirtyFiles).toEqual(["src/file.ts", "other.txt"]);
		} finally {
			spy.mockRestore();
			fsSpy.mockRestore();
		}
	});

	it("detects branch and commit changes", () => {
		const previous = {
			branch: "main",
			commit: "old1234",
			commitMessage: "old",
			isDirty: false,
			dirtyFiles: [],
			timestamp: new Date().toISOString(),
		};
		const current = {
			branch: "feature-x",
			commit: "new5678",
			commitMessage: "new",
			isDirty: false,
			dirtyFiles: [],
			timestamp: new Date().toISOString(),
		};
		const changes = detectGitChanges(previous, current);
		expect(changes.map((c) => c.type)).toEqual(["branch", "commit"]);
	});

	it("infers feature context from branch name", () => {
		const state = {
			branch: "feature/user-auth",
			commit: "abc1234",
			commitMessage: "add login",
			isDirty: true,
			dirtyFiles: ["src/api/routes.ts"],
			timestamp: new Date().toISOString(),
		};
		const ctx = inferFeatureContext(state, []);
		expect(ctx.type).toBe("feature");
		expect(ctx.description).toBe("user auth");
		expect(ctx.areas).toContain("api");
		expect(ctx.confidence).not.toBe("low");
	});
});

describe("recent commits", () => {
	it("returns empty array when git fails", () => {
		const fsSpy = spyOn(fs, "existsSync");
		fsSpy.mockReturnValue(false);
		try {
			expect(getRecentCommits("/tmp/nonexistent", 3)).toEqual([]);
		} finally {
			fsSpy.mockRestore();
		}
	});
});
