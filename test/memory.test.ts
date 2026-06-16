import { describe, expect, it } from "bun:test";
import { compileMemoryContext, formatContinuityContext } from "../extensions/memory.js";
import type { MemoryContextBlock } from "../extensions/memory.js";

describe("compileMemoryContext", () => {
	const fullBlock: MemoryContextBlock = {
		userRepresentation: "The user prefers concise engineering analysis.",
		userPeerCard: ["Keep changes narrowly scoped.", "Prefers TypeScript."],
		aiRepresentation: "The assistant is methodical.",
		aiPeerCard: ["Documents rationale in comments."],
		projectRepresentation: "This project values small PRs.",
		projectPeerCard: ["MIT license."],
		summary: "Recent work focused on Honcho memory.",
	};

	it("returns null when nothing to render", () => {
		expect(
			compileMemoryContext(
				{
					userRepresentation: "",
					userPeerCard: null,
					aiRepresentation: "",
					aiPeerCard: null,
					projectRepresentation: "",
					projectPeerCard: null,
					summary: null,
				},
				null,
			),
		).toBeNull();
	});

	it("includes all memory sections when present", () => {
		const compiled = compileMemoryContext(fullBlock, null);
		expect(compiled).not.toBeNull();
		expect(compiled).toContain("## Developer Memory");
		expect(compiled).toContain("## Agent Work Context");
		expect(compiled).toContain("## Project Memory");
		expect(compiled).toContain("## Recent Session Summary");
		expect(compiled).toContain("The user prefers concise engineering analysis.");
		expect(compiled).toContain("Keep changes narrowly scoped.");
		expect(compiled).toContain("Documents rationale in comments.");
	});

	it("appends prompt context when provided", () => {
		const promptContext = "## Relevant Memory\nPrompt-specific memory.";
		const compiled = compileMemoryContext(fullBlock, promptContext);
		expect(compiled).toContain("## Relevant Memory");
		expect(compiled).toContain("Prompt-specific memory.");
	});

	it("omits empty sections", () => {
		const compiled = compileMemoryContext(
			{
				...fullBlock,
				aiRepresentation: "",
				aiPeerCard: null,
				projectRepresentation: "",
				projectPeerCard: null,
				summary: null,
			},
			null,
		);
		expect(compiled).not.toContain("## Agent Work Context");
		expect(compiled).not.toContain("## Project Memory");
		expect(compiled).not.toContain("## Recent Session Summary");
		expect(compiled).toContain("## Developer Memory");
	});
});

describe("formatContinuityContext", () => {
	const mockHandles = {
		workspaceId: "ws-test",
		sessionId: "per-repo:demo",
		userPeerId: "user-dev",
		aiPeerId: "ai-dev",
		projectPeerId: "project-demo",
	} as never;

	it("renders peer metadata", () => {
		const ctx = formatContinuityContext(mockHandles, null, []);
		expect(ctx).toContain("## Honcho Continuity");
		expect(ctx).toContain("Workspace: ws-test");
		expect(ctx).toContain("Session key: per-repo:demo");
		expect(ctx).toContain("User peer: user-dev");
		expect(ctx).toContain("AI peer: ai-dev");
		expect(ctx).toContain("Project peer: project-demo");
	});

	it("includes last injected context", () => {
		const ctx = formatContinuityContext(mockHandles, "Previous memory block", []);
		expect(ctx).toContain("Last injected memory:");
		expect(ctx).toContain("Previous memory block");
	});

	it("includes recent durable conclusions", () => {
		const ctx = formatContinuityContext(mockHandles, null, ["I prefer dark mode", "Use bun"]);
		expect(ctx).toContain("Recent durable conclusions:");
		expect(ctx).toContain("- I prefer dark mode");
		expect(ctx).toContain("- Use bun");
	});
});
