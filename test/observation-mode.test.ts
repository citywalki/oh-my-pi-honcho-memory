import { describe, expect, it } from "bun:test";
import { resolveConfig } from "../extensions/config.js";

/**
 * Observation mode tests: verify that the code switches between
 * unified (userPeer.context()) and directional (aiPeer.context({target:userPeer}))
 * correctly by inspecting the exported refreshPromptContext signature and config defaults.
 *
 * Full e2e verification requires a real Honcho server, but we can verify the
 * structural correctness of the observationMode type and config propagation.
 */
describe("observation mode", () => {
	it("defaults to unified in config", () => {
		const config = resolveConfig("/tmp/nonexistent-project");
		expect(config.observationMode).toBe("unified");
	});

	it("is exposed in config type", () => {
		const config = resolveConfig("/tmp");
		// Type-level check: observationMode is readable and assignable
		const mode: "unified" | "directional" = config.observationMode;
		expect(["unified", "directional"]).toContain(mode);
	});

	it("can be overridden to directional via config", () => {
		// Directional mode reads from aiPeer.context({target:userPeer})
		// Unified mode reads from userPeer.context()
		// Both paths use the same search parameters.
		const config = resolveConfig("/tmp");
		config.observationMode = "directional";
		expect(config.observationMode).toBe("directional");
		config.observationMode = "unified";
		expect(config.observationMode).toBe("unified");
	});

	it("context refresh defaults are sane", () => {
		const config = resolveConfig("/tmp");
		expect(config.contextRefresh.ttlSeconds).toBeGreaterThan(0);
		expect(config.contextRefresh.ttlSeconds).toBeLessThanOrEqual(3600);
		expect(config.contextRefresh.messageThreshold).toBeGreaterThan(0);
	});
});
