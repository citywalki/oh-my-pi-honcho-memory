import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { resolveConfig, isConfigured } from "../extensions/config.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveConfig", () => {
	let originalHome: string | undefined;
	let tmpHome: string;
	let _saved: Record<string, string | undefined>;

	beforeEach(() => {
		_saved = {};
		for (const v of ["HONCHO_API_KEY", "HONCHO_PEER_NAME", "HONCHO_USERNAME", "HONCHO_WORKSPACE", "HONCHO_URL", "HONCHO_AI_PEER"]) {
			_saved[v] = process.env[v];
			delete process.env[v];
		}
		originalHome = process.env.HOME;
		tmpHome = join(tmpdir(), `honcho-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpHome, { recursive: true });
		process.env.HOME = tmpHome;
	});

	afterEach(() => {
		for (const v of ["HONCHO_API_KEY", "HONCHO_PEER_NAME", "HONCHO_USERNAME", "HONCHO_WORKSPACE", "HONCHO_URL", "HONCHO_AI_PEER"]) {
			if (_saved[v] !== undefined) process.env[v] = _saved[v];
			else delete process.env[v];
		}
		process.env.HOME = originalHome;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	// ---- Defaults (no config file) ----

	it("applies defaults when no config file exists", () => {
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.enabled).toBe(false);
		expect(config.url).toBe("https://api.honcho.dev");
		expect(config.workspace).toBe("oh-my-pi");
		expect(config.peerName).toBe("user");
		expect(config.aiPeer).toBe("ai-oh-my-pi");
		expect(config.sessionStrategy).toBe("per-directory");
		expect(config.sessionPeerPrefix).toBe(true);
		expect(config.observationMode).toBe("unified");
		expect(config.reasoningLevel).toBe("low");
		expect(config.saveMessages).toBe(true);
		expect(config.endpoint.environment).toBe("production");
		expect(config.messageUpload).toEqual({});
		expect(config.contextTokens).toBe(1200);
		expect(config.commitEveryNTurns).toBe(4);
		expect(config.contextRefresh.ttlSeconds).toBe(300);
		expect(config.contextRefresh.messageThreshold).toBe(30);
	});
	// ---- Global fields ----

	it("reads global fields from config.json", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ enabled: true, apiKey: "hch-key", workspace: "ws", peerName: "Alice", sessionPeerPrefix: false, contextTokens: 500 }),
		);
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.enabled).toBe(true);
		expect(config.apiKey).toBe("hch-key");
		expect(config.workspace).toBe("ws");
		expect(config.peerName).toBe("alice");
		expect(config.sessionPeerPrefix).toBe(false);
	});

	it("reads contextRefresh from config.json", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ contextRefresh: { ttlSeconds: 60, messageThreshold: 10 } }),
		);
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.contextRefresh.ttlSeconds).toBe(60);
		expect(config.contextRefresh.messageThreshold).toBe(10);
	});

	// ---- hosts.omp block ----

	it("reads hosts.omp block", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				workspace: "global-ws",
				hosts: { omp: { workspace: "omp-ws", aiPeer: "omp-ai" } },
			}),
		);
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.workspace).toBe("omp-ws");
		expect(config.aiPeer).toBe("omp-ai");
	});

	it("hosts.omp overrides global fields from same file", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				workspace: "global-ws",
				hosts: { omp: { workspace: "omp-ws" } },
			}),
		);
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.workspace).toBe("omp-ws");
	});

	// ---- directories block ----

	it("reads directories block with prefix match", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		const dir = join(tmpHome, "project");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				workspace: "global-ws",
				directories: { [dir]: { workspace: "dir-ws", sessionStrategy: "per-directory" } },
			}),
		);
		const config = resolveConfig(dir);
		expect(config.workspace).toBe("dir-ws");
		expect(config.sessionStrategy).toBe("per-directory");
	});

	it("directories block overrides apiKey per project", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		const projA = join(tmpHome, "proj-a");
		const projB = join(tmpHome, "proj-b");
		mkdirSync(projA, { recursive: true });
		mkdirSync(projB, { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				apiKey: "global-key",
				directories: {
					[projA]: { apiKey: "key-a", workspace: "ws-a" },
					[projB]: { apiKey: "key-b", workspace: "ws-b" },
				},
			}),
		);
		const configA = resolveConfig(projA);
		expect(configA.apiKey).toBe("key-a");
		expect(configA.workspace).toBe("ws-a");
		const configB = resolveConfig(projB);
		expect(configB.apiKey).toBe("key-b");
		expect(configB.workspace).toBe("ws-b");
	});

	it("directories: longest prefix match wins", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		const parent = join(tmpHome, "parent");
		const child = join(parent, "child");
		mkdirSync(child, { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				directories: {
					[parent]: { workspace: "parent-ws" },
					[child]: { workspace: "child-ws" },
				},
			}),
		);
		const config = resolveConfig(child);
		expect(config.workspace).toBe("child-ws");
	});

	it("directories: non-ancestor paths do not match", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		const dir = join(tmpHome, "dir-a");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({
				directories: {
					"/some/other/path": { workspace: "other-ws" },
				},
			}),
		);
		const config = resolveConfig(dir);
		expect(config.workspace).toBe("oh-my-pi"); // default, no match
	});

	// ---- Environment variables ----

	it("env vars override config file", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ workspace: "file-ws", apiKey: "file-key" }),
		);
		process.env.HONCHO_WORKSPACE = "env-ws";
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.workspace).toBe("env-ws");
		expect(config.apiKey).toBe("file-key"); // env doesn't override apiKey
		delete process.env.HONCHO_WORKSPACE;
	});

	it("expands ${VAR} in apiKey", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		process.env.MY_KEY = "expanded-key";
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ apiKey: "${MY_KEY}" }),
		);
		const config = resolveConfig("/tmp/nonexistent");
		expect(config.apiKey).toBe("expanded-key");
		delete process.env.MY_KEY;
	});
});

describe("isConfigured", () => {
	let originalHome: string | undefined;
	let tmpHome: string;
	let _saved: Record<string, string | undefined>;

	beforeEach(() => {
		_saved = {};
		for (const v of ["HONCHO_API_KEY", "HONCHO_PEER_NAME", "HONCHO_USERNAME", "HONCHO_WORKSPACE", "HONCHO_URL", "HONCHO_AI_PEER"]) {
			_saved[v] = process.env[v];
			delete process.env[v];
		}
		originalHome = process.env.HOME;
		tmpHome = join(tmpdir(), `honcho-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpHome, { recursive: true });
		process.env.HOME = tmpHome;
	});

	afterEach(() => {
		for (const v of ["HONCHO_API_KEY", "HONCHO_PEER_NAME", "HONCHO_USERNAME", "HONCHO_WORKSPACE", "HONCHO_URL", "HONCHO_AI_PEER"]) {
			if (_saved[v] !== undefined) process.env[v] = _saved[v];
			else delete process.env[v];
		}
		process.env.HOME = originalHome;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns false when no config and no env", () => {
		expect(isConfigured(resolveConfig("/tmp"))).toBe(false);
	});

	it("returns true when enabled, apiKey and workspace are present", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ enabled: true, workspace: "test-ws", apiKey: "hch-test" }),
		);
		expect(isConfigured(resolveConfig("/tmp"))).toBe(true);
	});

	it("returns false when disabled", () => {
		mkdirSync(join(tmpHome, ".honcho"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".honcho", "config.json"),
			JSON.stringify({ enabled: false, workspace: "test-ws", apiKey: "hch-test" }),
		);
		expect(isConfigured(resolveConfig("/tmp"))).toBe(false);
	});
});
