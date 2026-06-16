import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { HonchoHandles } from "./client.js";
import { saveProjectMemory } from "./memory.js";

export interface CommandRegistryDependencies {
	getHandles: (ctx: ExtensionContext) => Promise<HonchoHandles | null>;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandRegistryDependencies): void {
	pi.registerCommand("honcho-status", {
		description: "Show Honcho connection status, active peers, and session mapping.",
		async handler(_args, ctx) {
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				ctx.ui.notify("Honcho is not initialized for this session.", "warning");
				return;
			}
			const lines = [
				`Workspace: ${handles.workspaceId}`,
				`Session: ${handles.sessionId}`,
				`Developer peer: ${handles.userPeerId}`,
				`AI peer: ${handles.aiPeerId}`,
				`Project peer: ${handles.projectPeerId ?? "(not configured)"}`,
				`Endpoint: ${handles.config.url}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("honcho-save-to-project", {
		description: "Save a durable fact to the active project peer.",
		async handler(args, ctx) {
			const handles = await deps.getHandles(ctx);
			if (!handles) {
				ctx.ui.notify("Honcho is not initialized for this session.", "warning");
				return;
			}
			const content = args.join(" ").trim();
			if (!content) {
				ctx.ui.notify("Usage: /honcho-save-to-project <fact>", "warning");
				return;
			}
			const result = await saveProjectMemory(handles, content, { source: "command" });
			if (result.saved) {
				ctx.ui.notify("Saved to project memory.", "success");
			} else {
				ctx.ui.notify(result.error ?? "Failed to save.", "error");
			}
		},
	});
}
