import { describe, expect, it } from "bun:test";
import { compileMemoryContext, formatContinuityContext, extractTopics } from "../extensions/memory.js";
import type { MemoryContextBlock } from "../extensions/memory.js";

describe("compileMemoryContext", () => {
	const fullBlock: MemoryContextBlock = {
		userPeerName: "test-user",
		userRepresentation: "The user prefers concise engineering analysis.",
		userPeerCard: ["IDENTITY: Name: tester", "INSTRUCTION: Use English only.", "ATTRIBUTE: Employer: FA"],
		aiPeerName: "ai-test",
		aiRepresentation: "The assistant is methodical.",
		aiPeerCard: ["ROLE: Assistant", "Documents rationale in comments."],
		projectPeerName: "test-project",
		projectRepresentation: "This project values small PRs.",
		projectPeerCard: ["MIT license."],
		summary: "Recent work focused on Honcho memory.",
	};

	it("returns null when nothing to render", () => {
		expect(
			compileMemoryContext(
				{
					userPeerName: "",
					userRepresentation: "",
					userPeerCard: null,
					aiPeerName: "",
					aiRepresentation: "",
					aiPeerCard: null,
					projectPeerName: "",
					projectRepresentation: "",
					projectPeerCard: null,
					summary: null,
				},
				null,
			),
		).toBeNull();
	});

	it("includes all memory sections in compact format", () => {
		const compiled = compileMemoryContext(fullBlock, null);
		expect(compiled).not.toBeNull();
		expect(compiled).toContain("## Honcho Memory");
		expect(compiled).toContain("Developer");
		expect(compiled).toContain("AI");
		expect(compiled).toContain("Project");
		expect(compiled).toContain("Recent");
		expect(compiled).toContain("The user prefers concise engineering analysis.");
		expect(compiled).toContain("Name: tester");
		expect(compiled).toContain("Use English only.");
		expect(compiled).toContain("Assistant");
	});

	it("appends prompt context when provided", () => {
		const promptContext = {
			representation: "Prompt-specific memory.",
			peerCard: null,
		};
		const compiled = compileMemoryContext(fullBlock, promptContext);
		expect(compiled).toContain("Relevant");
		expect(compiled).toContain("Prompt-specific memory.");
	});

	it("renders prompt context peer cards", () => {
		const promptContext = {
			representation: "",
			peerCard: ["This rule matters."],
		};
		const compiled = compileMemoryContext(fullBlock, promptContext);
		expect(compiled).toContain("Relevant");
		expect(compiled).toContain("This rule matters.");
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
		expect(compiled).not.toContain("**AI**");
		expect(compiled).not.toContain("**Project**");
		expect(compiled).not.toContain("**Recent**");
		expect(compiled).toContain("Developer");
	});
});

describe("extractTopics", () => {
	it("extracts file paths from a prompt", () => {
		const topics = extractTopics("Fix the bug in src/index.ts and test/memory.test.ts");
		expect(topics).toContain("src/index.ts");
		expect(topics).toContain("test/memory.test.ts");
	});

	it("extracts quoted strings", () => {
		const topics = extractTopics('What does "release process" mean here?');
		expect(topics).toContain("release process");
	});

	it("extracts technical terms", () => {
		const topics = extractTopics("Should we deploy with docker or kubernetes?");
		expect(topics.some((t: string) => t.toLowerCase().includes("docker"))).toBe(true);
		expect(topics.some((t: string) => t.toLowerCase().includes("kubernetes"))).toBe(true);
	});

	it("extracts Chinese release terms", () => {
		const topics = extractTopics("是不是应该发个新版了");
		expect(topics.some((t: string) => t.includes("发版") || t.includes("版本") || t.includes("新版"))).toBe(true);
	});

	it("falls back to meaningful words when no signals match", () => {
		const topics = extractTopics("tell me about the architecture");
		expect(topics.some((t: string) => t.includes("architecture"))).toBe(true);
	});

	it("returns empty array for empty prompt", () => {
		expect(extractTopics("")).toEqual([]);
		expect(extractTopics("   ")).toEqual([]);
	});

	it("handles prompts with only stopwords", () => {
		const topics = extractTopics("the and for this with from");
		expect(topics.length).toBeLessThanOrEqual(2);
	});

	it("deduplicates repeated terms", () => {
		const topics = extractTopics("docker docker kubernetes kubernetes");
		const lower = topics.map((t: string) => t.toLowerCase());
		expect(lower.filter((t) => t === "docker").length).toBe(1);
		expect(lower.filter((t) => t === "kubernetes").length).toBe(1);
	});

	it("limits number of fallback words", () => {
		const topics = extractTopics(
			"alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa",
		);
		expect(topics.length).toBeLessThanOrEqual(10);
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
		const ctx = formatContinuityContext(mockHandles, "previous context", []);
		expect(ctx).toContain("previous context");
	});

	it("includes recent durable conclusions", () => {
		const ctx = formatContinuityContext(mockHandles, null, ["Use patch releases for bug fixes."]);
		expect(ctx).toContain("Recent durable conclusions");
		expect(ctx).toContain("Use patch releases for bug fixes.");
	});
});
