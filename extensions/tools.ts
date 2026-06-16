import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { HonchoHandles } from "./client.js";
import { saveProjectConclusion } from "./memory.js";

export interface ToolRegistryDependencies {
	getHandles: (ctx: ExtensionContext) => Promise<HonchoHandles | null>;
}

export function registerTools(pi: ExtensionAPI, deps: ToolRegistryDependencies): void {
	const z = pi.zod;

	pi.registerTool({
		name: "honcho_search",
		label: "Honcho Search",
		description:
			"Search the current Honcho workspace for relevant messages, memories, or conclusions across the developer and project peers.",
		parameters: z.object({
			query: z.string().describe("The search query."),
			target: z.enum(["user", "project", "all"]).default("all"),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { query: string; target: "user" | "project" | "all" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				const peerIds =
					params.target === "user"
						? [handles.userPeerId]
						: params.target === "project"
						  ? [handles.projectPeerId ?? ""]
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
		name: "honcho_chat",
		label: "Honcho Chat",
		description:
			"Ask Honcho to reason over the developer or project memory. Useful for summarizing what is known about a topic.",
		parameters: z.object({
			query: z.string().describe("The question to reason about."),
			target: z.enum(["user", "project"]).default("user"),
		}),
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { query: string; target: "user" | "project" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			const targetPeer = params.target === "project" ? handles.projectPeer : handles.userPeer;
			if (!targetPeer) {
				return {
					content: [{ type: "text", text: `No ${params.target} peer is configured.` }],
					isError: true,
				};
			}
			try {
				const answer = await handles.aiPeer.chat(params.query, {
					target: targetPeer,
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
		name: "honcho_remember",
		label: "Honcho Remember",
		description:
			"Save a durable fact to Honcho. Use target=user for developer-specific observations and target=project for team conventions or decisions.",
		parameters: z.object({
			content: z.string().describe("The fact to remember."),
			target: z.enum(["user", "project"]).default("user"),
		}),
		approval: "write",
		async execute(_id, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as { content: string; target: "user" | "project" };
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				return { content: [{ type: "text", text: "Honcho is not initialized for this session." }] };
			}
			try {
				if (params.target === "project") {
					const result = await saveProjectConclusion(handles, params.content);
					return {
						content: [
							{ type: "text", text: result.saved ? "Saved to project memory." : `Failed: ${result.error}` },
						],
						isError: !result.saved,
					};
				}
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
