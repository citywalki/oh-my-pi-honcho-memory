import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { resolveConfig, isConfigured } from "../extensions/config.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveConfig", () => {
	let originalHome: string | undefined;
	let tmpHome: string;

	beforeEach(() => {
		originalHome = process.env.HOME;
		tmpHome = join(tmpdir(), `omp-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tmpHome, ".omp", "agent"), { recursive: true });
		process.env.HOME = tmpHome;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it("applies defaults", () => {
		const config = resolveConfig("/tmp/nonexistent-project");
		expect(config.enabled).toBe(true);
		expect(config.url).toBe("https://api.honcho.dev");
		expect(config.workspace).toBe("oh-my-pi");
		expect(config.peerName).toBe("user");
		expect(config.aiPeer).toBe("ai-oh-my-pi");
		expect(config.sessionStrategy).toBe("per-repo");
		expect(config.observationMode).toBe("unified");
		expect(config.contextTokens).toBe(1200);
		expect(config.commitEveryNTurns).toBe(4);
		expect(config.contextRefresh.ttlSeconds).toBe(300);
		expect(config.contextRefresh.messageThreshold).toBe(30);
	});

	it("reads project config", () => {
		const dir = join(tmpHome, "project");
		mkdirSync(join(dir, ".omp"), { recursive: true });
		writeFileSync(
			join(dir, ".omp", "config.yml"),
			"honcho:\n  workspace: project-ws\n  observationMode: directional\n  contextRefresh:\n    ttlSeconds: 60\n",
		);
		const config = resolveConfig(dir);
		expect(config.workspace).toBe("project-ws");
		expect(config.observationMode).toBe("directional");
		expect(config.contextRefresh.ttlSeconds).toBe(60);
	});

	it("reads global config", () => {
		writeFileSync(
			join(tmpHome, ".omp", "agent", "config.yml"),
			"honcho:\n  workspace: global-ws\n  apiKey: hch-global\n",
		);
		const config = resolveConfig("/tmp/nonexistent-project");
		expect(config.workspace).toBe("global-ws");
		expect(config.apiKey).toBe("hch-global");
	});

	it("project config overrides global config", () => {
		writeFileSync(
			join(tmpHome, ".omp", "agent", "config.yml"),
			"honcho:\n  workspace: global-ws\n  apiKey: hch-global\n",
		);
		const dir = join(tmpHome, "project");
		mkdirSync(join(dir, ".omp"), { recursive: true });
		writeFileSync(join(dir, ".omp", "config.yml"), "honcho:\n  workspace: project-ws\n");
		const config = resolveConfig(dir);
		expect(config.workspace).toBe("project-ws");
		expect(config.apiKey).toBe("hch-global");
	});

	it("normalizes peer names", () => {
		const dir = join(tmpHome, "project");
		mkdirSync(join(dir, ".omp"), { recursive: true });
		writeFileSync(
			join(dir, ".omp", "config.yml"),
			"honcho:\n  peerName: 'User Alice Smith'\n",
		);
		const config = resolveConfig(dir);
		expect(config.peerName).toBe("user-alice-smith");
	});

	it("expands env in apiKey", () => {
		process.env.TEST_HONCHO_KEY = "hch-test-key";
		const dir = join(tmpHome, "project");
		mkdirSync(join(dir, ".omp"), { recursive: true });
		writeFileSync(join(dir, ".omp", "config.yml"), "honcho:\n  apiKey: '${TEST_HONCHO_KEY}'\n");
		const config = resolveConfig(dir);
		expect(config.apiKey).toBe("hch-test-key");
		delete process.env.TEST_HONCHO_KEY;
	});
});

describe("isConfigured", () => {
	let originalHome: string | undefined;
	let tmpHome: string;

	beforeEach(() => {
		originalHome = process.env.HOME;
		tmpHome = join(tmpdir(), `omp-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(join(tmpHome, ".omp", "agent"), { recursive: true });
		process.env.HOME = tmpHome;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns false when apiKey or workspace is missing", () => {
		expect(isConfigured(resolveConfig("/tmp"))).toBe(false);
	});

	it("returns true when enabled, apiKey and workspace are present", () => {
		writeFileSync(
			join(tmpHome, ".omp", "agent", "config.yml"),
			"honcho:\n  workspace: test-ws\n  apiKey: hch-test\n",
		);
		expect(isConfigured(resolveConfig("/tmp"))).toBe(true);
	});

	it("returns false when disabled", () => {
		writeFileSync(
			join(tmpHome, ".omp", "agent", "config.yml"),
			"honcho:\n  enabled: false\n  workspace: test-ws\n  apiKey: hch-test\n",
		);
		expect(isConfigured(resolveConfig("/tmp"))).toBe(false);
	});
});
