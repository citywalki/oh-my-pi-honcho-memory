import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { HonchoHandles } from "./client.js";

export interface ToolRegistryDependencies {
	getHandles: (ctx: ExtensionContext) => Promise<HonchoHandles | null>;
}

export function registerTools(pi: ExtensionAPI, deps: ToolRegistryDependencies): void {
	const z = pi.zod;

	pi.registerTool({
		name: "honcho_search",
		label: "Honcho Search",
		description:
			"Search the current Honcho workspace for relevant messages, memories, or conclusions across the developer peer.",
		parameters: z.object({
			query: z.string().describe("The search query."),
			target: z.enum(["user", "all"]).default("all"),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { query: string; target: "user" | "all" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				const peerIds =
					params.target === "user"
						? [handles.userPeerId]
						: undefined;
				const results = await handles.session.search(params.query, { peerIds });
				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
				};
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Honcho search failed: ${detail}` }],
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "honcho_get_context",
		label: "Honcho Get Context",
		description:
			"Retrieve Honcho memory context for the developer or AI peer. Use this to recall stable facts and preferences without doing a semantic search.",
		parameters: z.object({
			target: z.enum(["user", "ai"]).default("user"),
			maxConclusions: z.number().int().min(1).max(100).default(15),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { target: "user" | "ai"; maxConclusions: number };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				const peer =
					params.target === "ai"
						? handles.aiPeer
						: handles.userPeer;
				if (!peer) {
					return {
						content: [{ type: "text", text: `No ${params.target} peer is configured.` }],
						isError: true,
					};
				}
				const result = await peer.context({ maxConclusions: params.maxConclusions, includeMostFrequent: true });
				const parts: string[] = [];
				if (result.representation) parts.push(result.representation);
				if (result.peerCard?.length) parts.push(...result.peerCard.map((f: string) => `- ${f}`));
				return {
					content: [{ type: "text", text: parts.length ? parts.join("\n\n") : "No context available." }],
				};
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Honcho get_context failed: ${detail}` }],
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "honcho_chat",
		label: "Honcho Chat",
		description:
			"Ask Honcho to reason over the developer memory. Useful for summarizing what is known about a topic.",
		parameters: z.object({
			query: z.string().describe("The question to reason about."),
			target: z.enum(["user"]).default("user"),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { query: string; target: "user" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				const answer = await handles.aiPeer.chat(params.query, {
					target: handles.userPeer,
					session: handles.session,
				});
				return {
					content: [{ type: "text", text: answer ?? "No answer returned." }],
				};
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Honcho chat failed: ${detail}` }],
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "honcho_list_conclusions",
		label: "Honcho List Conclusions",
		description:
			"List durable conclusions stored for the developer peer. Useful for inspecting what Honcho currently remembers.",
		parameters: z.object({
			target: z.enum(["user"]).default("user"),
			limit: z.number().int().min(1).max(100).default(20),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { target: "user"; limit: number };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				const peerId = handles.userPeerId;
				if (!peerId) {
					return {
						content: [{ type: "text", text: `No ${params.target} peer is configured.` }],
						isError: true,
					};
				}
				const peer = await handles.honcho.peer(peerId);
				const page = await peer.conclusions.list({ size: params.limit });
				const items = page.items ?? [];
				const lines = items.map((item: { content?: string }) => `- ${item.content ?? ""}`);
				return {
					content: [
						{
							type: "text",
							text: lines.length ? lines.join("\n") : "No conclusions found.",
						},
					],
				};
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Honcho list_conclusions failed: ${detail}` }],
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "honcho_add_conclusion",
		description:
			"Save a durable conclusion to Honcho. Use target=user for developer-specific observations.",
		parameters: z.object({
			content: z.string().describe("The conclusion to save."),
			target: z.enum(["user"]).default("user"),
		}),
		approval: "write",
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { content: string; target: "user" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				await handles.aiPeer.conclusionsOf(handles.userPeer).create({
					content: params.content,
					sessionId: handles.session.id,
				});
				return { content: [{ type: "text", text: "Saved to developer memory." }] };
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to save conclusion: ${detail}` }],
					isError: true,
				};
			}
		},
	});

	// Backwards-compatible alias.
	pi.registerTool({
		name: "honcho_remember",
		label: "Honcho Remember",
		description: "Alias for honcho_add_conclusion. Save a durable fact to Honcho.",
		parameters: z.object({
			content: z.string().describe("The fact to remember."),
			target: z.enum(["user"]).default("user"),
		}),
		approval: "write",
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { content: string; target: "user" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				await handles.aiPeer.conclusionsOf(handles.userPeer).create({
					content: params.content,
					sessionId: handles.session.id,
				});
				return { content: [{ type: "text", text: "Saved to developer memory." }] };
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to save memory: ${detail}` }],
					isError: true,
				};
			}
		},
	});
}
