import { Honcho } from "@honcho-ai/sdk";
import type { HonchoExtensionConfig } from "./config.js";

export type SessionKey = string;

export interface HonchoMessage {
	peerId: string;
	content: string;
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

export interface HonchoPeer {
	id: string;
	message(content: string, options?: { metadata?: Record<string, unknown>; createdAt?: string }): HonchoMessage;
	context(options?: {
		maxConclusions?: number;
		includeMostFrequent?: boolean;
		topic?: string;
	}): Promise<{ representation: string; peerCard: string[] | null }>;
	conclusionsOf(targetPeer: HonchoPeer): {
		create(params: { content: string; sessionId?: string }): Promise<unknown>;
	};
	chat(
		query: string,
		options?: { target?: HonchoPeer; session?: HonchoSession; reasoningLevel?: string },
	): Promise<string | null>;
}

export interface HonchoSession {
	id: string;
	addMessages(messages: HonchoMessage[]): Promise<unknown>;
	addPeers(peers: [string, { observeMe: boolean; observeOthers: boolean }][]): Promise<unknown>;
	summaries(): Promise<{ shortSummary?: string; longSummary?: string }>;
	context(options?: {
		summary?: boolean;
		peerPerspective?: HonchoPeer;
		peerTarget?: HonchoPeer;
		limitToSession?: boolean;
		representationOptions?: {
			searchQuery?: string;
			searchTopK?: number;
			searchMaxDistance?: number;
			maxConclusions?: number;
		};
	}): Promise<{ summary?: string; peerRepresentation?: string }>;
	search(query: string, options?: unknown): Promise<unknown[]>;
}

export interface HonchoHandles {
	honcho: Honcho;
	workspaceId: string;
	sessionId: SessionKey;
	userPeerId: string;
	aiPeerId: string;
	projectPeerId: string | null;
	userPeer: HonchoPeer;
	aiPeer: HonchoPeer;
	projectPeer: HonchoPeer | null;
	session: HonchoSession;
	config: HonchoExtensionConfig;
}

export async function createHonchoHandles(params: {
	config: HonchoExtensionConfig;
	sessionKey: SessionKey;
}): Promise<HonchoHandles> {
	const honcho = new Honcho({
		apiKey: params.config.apiKey || undefined,
		baseURL: params.config.url || undefined,
		workspaceId: params.config.workspace,
	});

	const userPeerId = `user:${params.config.peerName}`;
	const aiPeerId = `ai:${params.config.aiPeer.replace(/^ai-/, "")}`;
	const projectPeerId = params.config.projectPeer
		? `project:${params.config.projectPeer.replace(/^project-/, "")}`
		: null;

	const [userPeer, aiPeer, session] = await Promise.all([
		honcho.peer(userPeerId, { configuration: { observeMe: true } }) as Promise<unknown>,
		honcho.peer(aiPeerId, { configuration: { observeMe: true } }) as Promise<unknown>,
		honcho.session(params.sessionKey) as Promise<unknown>,
	]);

	const projectPeer = projectPeerId
		? ((await honcho.peer(projectPeerId, { configuration: { observeMe: true } })) as unknown)
		: null;

	const peerConfigs: Record<string, { observeMe: boolean; observeOthers: boolean }> = {
		[userPeerId]: { observeMe: true, observeOthers: false },
		[aiPeerId]: { observeMe: true, observeOthers: true },
	};
	if (projectPeerId) {
		peerConfigs[projectPeerId] = { observeMe: true, observeOthers: false };
	}

	const honchoSession = session as HonchoSession;
	await honchoSession.addPeers(Object.entries(peerConfigs) as [string, { observeMe: boolean; observeOthers: boolean }][]);

	return {
		honcho,
		workspaceId: params.config.workspace,
		sessionId: params.sessionKey,
		userPeerId,
		aiPeerId,
		projectPeerId,
		userPeer: userPeer as HonchoPeer,
		aiPeer: aiPeer as HonchoPeer,
		projectPeer: projectPeer as HonchoPeer | null,
		session: honchoSession,
		config: params.config,
	};
}
