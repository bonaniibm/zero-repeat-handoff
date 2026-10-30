/**
 * Parses the transcript Dynamics 365 saves when a conversation closes (an annotation on msdyn_transcript):
 * a JSON array whose first item's "Content" is itself a JSON array of messages.
 * Works everywhere, unlike the live msdyn_commontranscriptmessage table, which some orgs don't populate.
 */
import type { TranscriptMessage } from "./reask";

interface RawMessage {
    id?: string;
    content?: string;
    createdDateTime?: string;
    created?: string;
    isControlMessage?: boolean;
    isFromAgent?: boolean;
    deleted?: boolean;
    tags?: string;
    from?: { user?: { displayName?: string }; application?: { displayName?: string } };
}

const BOT_TAGS = /(^|,)\s*(bot|botmessage|frombot|copilot)\s*(,|$)/i;
const BOT_NAME = /microsoft copilot studio|\bbot\b|virtual agent/i;
const HTML_TAGS = /<[^>]+>/g;

/**
 * In real transcripts the Copilot Studio agent's messages ALSO have isFromAgent: true; they come from a
 * user named "<agent> (Microsoft Copilot Studio)". Human messages carry a "public" tag. Hidden context
 * events and the escalation event (tags holding JSON) are system messages.
 */
export function roleOf(m: RawMessage): string {
    const tags = (m.tags ?? "").toLowerCase();
    if (tags.startsWith("{") || tags.includes("hidden") || tags.includes("omnichannelcontextmessage")) return "system";
    if (tags.includes("fromcustomer")) return "customer";
    const name = m.from?.user?.displayName ?? m.from?.application?.displayName ?? "";
    if (BOT_TAGS.test(tags) || BOT_NAME.test(name)) return "bot";
    if (m.isFromAgent || tags.split(",").includes("public")) return "agent";
    if (m.from?.application) return "bot";
    return "system";
}

/** documentText: the decoded annotation documentbody. */
export function parseTranscriptDocument(documentText: string): TranscriptMessage[] {
    let outer: unknown;
    try {
        outer = JSON.parse(documentText);
    } catch {
        return [];
    }
    let raw: RawMessage[] = [];
    const first = Array.isArray(outer) ? (outer[0] as { Content?: string } | undefined) : undefined;
    if (first && typeof first.Content === "string") {
        try {
            raw = JSON.parse(first.Content) as RawMessage[];
        } catch {
            return [];
        }
    } else if (Array.isArray(outer)) {
        raw = outer as RawMessage[];
    }
    return raw
        .filter((m) => !m.isControlMessage && !m.deleted && typeof m.content === "string" && m.content.trim() !== "")
        .map((m, i) => ({
            id: m.id ?? String(i),
            role: roleOf(m),
            text: m.content!.replace(HTML_TAGS, " ").trim(),
            at: m.createdDateTime ?? m.created ?? "",
        }))
        .sort((a, b) => a.at.localeCompare(b.at));
}
