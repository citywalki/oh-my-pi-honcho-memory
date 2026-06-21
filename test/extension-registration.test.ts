import { describe, expect, it } from "bun:test";
import { registerTools, type ToolRegistryDependencies } from "../extensions/tools.js";
import { registerCommands, type CommandRegistryDependencies } from "../extensions/commands.js";

function createZodMock(): object {
	const handler: ProxyHandler<() => unknown> = {
		get(_target, prop) {
			if (prop === "object") {
				return (spec: Record<string, unknown>) => spec;
			}
			return createZodMock();
		},
		apply() {
			return createZodMock();
		},
	};
	return new Proxy(() => {}, handler);
}

interface ToolEntry {
	name: string;
}

interface CommandEntry {
	name: string;
	description: string;
}

function createMockPi() {
	const registeredTools: ToolEntry[] = [];
	const registeredCommands: CommandEntry[] = [];

	const module = {
		zod: createZodMock(),
		registerTool(def: ToolEntry) {
			registeredTools.push(def);
		},
		registerCommand(
			name: string,
			opts: { description?: string; handler: (...args: unknown[]) => unknown },
		) {
			registeredCommands.push({ name, description: opts.description ?? "" });
		},
	};

	return { module, registeredTools, registeredCommands };
}

describe("registerTools", () => {
	it("registers all required honcho tools", () => {
		const { module, registeredTools } = createMockPi();
		const deps: ToolRegistryDependencies = { getHandles: async () => null };
		registerTools(module as never, deps);

		const names = registeredTools.map((t) => t.name);
		expect(names).toContain("honcho_search");
		expect(names).toContain("honcho_get_context");
		expect(names).toContain("honcho_get_representation");
		expect(names).toContain("honcho_chat");
		expect(names).toContain("honcho_list_conclusions");
		expect(names).toContain("honcho_add_conclusion");
		expect(names).toContain("honcho_remember");
		expect(names).toContain("honcho_delete_conclusion");
		expect(names).toContain("honcho_get_config");
	});

	it("registers exactly 10 tools", () => {
		const { module, registeredTools } = createMockPi();
		registerTools(module as never, { getHandles: async () => null });
		expect(registeredTools.length).toBe(10);
	});
});

describe("registerCommands", () => {
	it("registers all required honcho commands", () => {
		const { module, registeredCommands } = createMockPi();
		const deps: CommandRegistryDependencies = { getHandles: async () => null };
		registerCommands(module as never, deps);

		const names = registeredCommands.map((c) => c.name);
		expect(names).toContain("honcho-status");
		expect(names).toContain("honcho-config");
		expect(names).toContain("honcho-setup");
	});

	it("registers exactly 3 commands", () => {
		const { module, registeredCommands } = createMockPi();
		registerCommands(module as never, { getHandles: async () => null });
		expect(registeredCommands.length).toBe(3);
	});
});
