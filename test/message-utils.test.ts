import { describe, expect, it } from "bun:test";
import {
	extractTextFromMessage,
	extractToolNameFromMessage,
	summarizeToolResult,
	collectMessagePairs,
	collectToolSummary,
	extractDurableConclusion,
} from "../extensions/message-utils.js";

describe("extractTextFromMessage", () => {
	it("handles string content", () => {
		expect(extractTextFromMessage({ role: "user", content: "hello" })).toBe("hello");
	});

	it("concatenates text parts", () => {
		expect(
			extractTextFromMessage({
				role: "assistant",
				content: [
					{ type: "text", text: "line 1" },
					{ type: "text", text: "line 2" },
				],
			}),
		).toBe("line 1\nline 2");
	});

	it("ignores tool calls and unknown parts", () => {
		expect(
			extractTextFromMessage({
				role: "assistant",
				content: [
					{ type: "text", text: "ok" },
					{ type: "toolCall", name: "bash", arguments: {} },
					{ type: "reasoning", text: "internal" },
				],
			}),
		).toBe("ok");
	});
});

describe("extractToolNameFromMessage", () => {
	it("reads toolCall names", () => {
		expect(
			extractToolNameFromMessage({
				role: "assistant",
				content: [
					{ type: "toolCall", name: "bash", arguments: {} },
					{ type: "toolCall", name: "read", arguments: {} },
				],
			}),
		).toBe("bash, read");
	});

	it("returns null when no tool calls", () => {
		expect(extractToolNameFromMessage({ role: "assistant", content: "just text" })).toBeNull();
	});
});

describe("summarizeToolResult", () => {
	it("extracts first line of tool output", () => {
		expect(
			summarizeToolResult({
				role: "tool",
				content: "first line\nsecond line\nthird line",
			}),
		).toBe("first line");
	});

	it("truncates long output", () => {
		const long = "a".repeat(200);
		expect(
			summarizeToolResult({
				role: "tool",
				content: long,
			}),
		).toBe(`${"a".repeat(120)}...`);
	});

	it("returns null for non-tool messages", () => {
		expect(
			summarizeToolResult({
				role: "assistant",
				content: "not a tool",
			}),
		).toBeNull();
	});
});

describe("collectMessagePairs", () => {
	it("keeps user and assistant messages", () => {
		const pairs = collectMessagePairs([
			{ role: "system", content: "system" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: [{ type: "text", text: "hello" }] },
			{ role: "tool", content: "result" },
		]);
		expect(pairs).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		]);
	});

	it("returns empty array for undefined input", () => {
		expect(collectMessagePairs(undefined)).toEqual([]);
	});
});

describe("collectToolSummary", () => {
	it("pairs tool calls with results", () => {
		const summary = collectToolSummary([
			{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] },
			{ role: "tool", content: "main.ts\nindex.ts" },
		]);
		expect(summary).toBe("bash: main.ts");
	});

	it("handles multiple tools", () => {
		const summary = collectToolSummary([
			{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] },
			{ role: "tool", content: "one" },
			{ role: "assistant", content: [{ type: "toolCall", name: "read", arguments: {} }] },
			{ role: "tool", content: "two" },
		]);
		expect(summary).toBe("bash: one; read: two");
	});

	it("ignores orphan tool results", () => {
		const summary = collectToolSummary([{ role: "tool", content: "orphan" }]);
		expect(summary).toBe("tool: orphan");
	});

	it("returns null when no tool results", () => {
		expect(collectToolSummary([{ role: "assistant", content: "no tools" }])).toBeNull();
	});
});

describe("extractDurableConclusion", () => {
	it("matches English preference phrases", () => {
		expect(extractDurableConclusion("I prefer TypeScript")).toBe("I prefer TypeScript");
		expect(extractDurableConclusion("We should always run tests first")).toBe(
			"We should always run tests first",
		);
		expect(extractDurableConclusion("My favorite editor is Zed")).toBe("My favorite editor is Zed");
	});

	it("matches Chinese preference phrases", () => {
		expect(extractDurableConclusion("我喜欢用 TypeScript")).toBe("我喜欢用 TypeScript");
		expect(extractDurableConclusion("我们不要直接改 main 分支")).toBe("我们不要直接改 main 分支");
		expect(extractDurableConclusion("我的偏好是浅色主题")).toBe("我的偏好是浅色主题");
	});

	it("matches broader Chinese preference phrases", () => {
		expect(extractDurableConclusion("我习惯用 bun 跑测试")).toBe("我习惯用 bun 跑测试");
		expect(extractDurableConclusion("我倾向于 REST 而不是 GraphQL")).toBe("我倾向于 REST 而不是 GraphQL");
	});

	it("returns null for neutral statements", () => {
		expect(extractDurableConclusion("What is the weather?")).toBeNull();
		expect(extractDurableConclusion("请帮我修这个 bug")).toBeNull();
		expect(extractDurableConclusion("ok")).toBeNull();
	});
});
