import type { HonchoHandles, HonchoPeer } from "./client.js";

export interface MemoryContextBlock {
	userRepresentation: string;
	userPeerCard: string[] | null;
	projectRepresentation: string;
	projectPeerCard: string[] | null;
	summary: string | null;
}

function clampText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseRepresentation(value: unknown): string {
	return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseSessionSummary(value: unknown): string {
	return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function hydrateMemoryContext(handles: HonchoHandles): Promise<MemoryContextBlock> {
	const projectPeer = handles.projectPeer;

	const [userCtx, projectCtx, summaries] = await Promise.allSettled([
		handles.userPeer.context({ maxConclusions: 12, includeMostFrequent: true }),
		projectPeer?.context({ maxConclusions: 12, includeMostFrequent: true }) ??
			Promise.resolve({ representation: "", peerCard: null }),
		handles.session.summaries(),
	]);

	const userRepresentation =
		userCtx.status === "fulfilled" ? parseRepresentation(userCtx.value.representation) : "";
	const userPeerCard = userCtx.status === "fulfilled" ? userCtx.value.peerCard : null;
	const projectRepresentation =
		projectCtx.status === "fulfilled" ? parseRepresentation(projectCtx.value.representation) : "";
	const projectPeerCard = projectCtx.status === "fulfilled" ? projectCtx.value.peerCard : null;
	const summary =
		summaries.status === "fulfilled"
			? parseSessionSummary(summaries.value.shortSummary) ||
			  parseSessionSummary(summaries.value.longSummary)
			: null;

	return {
		userRepresentation,
		userPeerCard,
		projectRepresentation,
		projectPeerCard,
		summary,
	};
}

export async function refreshPromptContext(
	handles: HonchoHandles,
	query: string,
): Promise<string | null> {
	if (!query.trim()) return null;

	const sessionContext = await handles.session.context({
		summary: true,
		peerPerspective: handles.aiPeer,
		peerTarget: handles.userPeer,
		representationOptions: {
			searchQuery: query,
			searchTopK: 5,
			searchMaxDistance: 0.7,
			maxConclusions: 6,
		},
	});

	const summary = parseSessionSummary(sessionContext.summary);
	const representation = parseRepresentation(sessionContext.peerRepresentation);

	if (!summary && !representation) return null;

	const parts: string[] = [];
	if (summary) parts.push(`## Recent Session Summary\n${summary}`);
	if (representation) parts.push(`## Relevant Memory\n${representation}`);
	return parts.join("\n\n");
}

function formatPeerContextBlock(
	heading: string,
	representation: string,
	peerCard: string[] | null,
): string | null {
	const lines: string[] = [];
	if (representation) lines.push(representation);
	if (peerCard && peerCard.length > 0) {
		lines.push("Key facts:");
		for (const fact of peerCard) {
			lines.push(`- ${fact}`);
		}
	}
	if (lines.length === 0) return null;
	return `${heading}\n${lines.join("\n")}`;
}

export function compileMemoryContext(
	block: MemoryContextBlock,
	promptContext: string | null,
): string | null {
	const sections: string[] = [];

	const userBlock = formatPeerContextBlock("## Developer Memory", block.userRepresentation, block.userPeerCard);
	if (userBlock) sections.push(userBlock);

	const projectBlock = formatPeerContextBlock(
		"## Project Memory",
		block.projectRepresentation,
		block.projectPeerCard,
	);
	if (projectBlock) sections.push(projectBlock);

	if (block.summary) sections.push(`## Recent Session Summary\n${block.summary}`);
	if (promptContext) sections.push(promptContext);

	if (sections.length === 0) return null;

	return [
		"## Honcho Memory",
		"Use this as persistent developer and project memory. Prefer it over guessing, but only mention it when relevant to the current task.",
		"",
		sections.join("\n\n"),
	].join("\n");
}

export async function saveUserMessage(
	handles: HonchoHandles,
	content: string,
	metadata: Record<string, unknown> = {},
	createdAt?: string,
): Promise<void> {
	const trimmed = clampText(content.trim(), 25_000);
	if (!trimmed) return;
	await handles.session.addMessages([
		handles.userPeer.message(trimmed, { metadata, createdAt }),
	]);
}

export async function saveProjectMemory(
	handles: HonchoHandles,
	content: string,
	metadata: Record<string, unknown> = {},
): Promise<{ saved: boolean; error?: string }> {
	const projectPeer = handles.projectPeer;
	if (!projectPeer) {
		return { saved: false, error: "No project peer configured for this directory." };
	}
	const trimmed = clampText(content.trim(), 25_000);
	if (!trimmed) return { saved: false, error: "Empty content." };
	await handles.session.addMessages([projectPeer.message(trimmed, { metadata })]);
	return { saved: true };
}

export async function saveProjectConclusion(
	handles: HonchoHandles,
	content: string,
): Promise<{ saved: boolean; error?: string }> {
	const projectPeer = handles.projectPeer;
	if (!projectPeer) {
		return { saved: false, error: "No project peer configured for this directory." };
	}
	const trimmed = clampText(content.trim(), 25_000);
	if (!trimmed) return { saved: false, error: "Empty content." };
	await handles.aiPeer.conclusionsOf(projectPeer).create({
		content: trimmed,
		sessionId: handles.session.id,
	});
	return { saved: true };
}
