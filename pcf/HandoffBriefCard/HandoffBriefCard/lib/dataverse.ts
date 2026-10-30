/**
 * Everything that talks to Dataverse or the Copilot Service workspace host.
 * Each source is optional: the card keeps working with whatever is available.
 */
import { buildFallbackBrief, parseBrief, type LoadedBrief } from "./brief";
import type { HandoffScore, TranscriptMessage } from "./reask";

type WebApi = ComponentFramework.WebApi;

interface ContextItem {
    msdyn_name?: string;
    msdyn_value?: string;
}

/** Host globals that exist only inside Copilot Service workspace. */
interface HostWindow {
    Microsoft?: {
        Omnichannel?: { getConversationId?: () => Promise<string> };
        Apm?: { getFocusedSession?: () => { getContext?: () => Promise<{ parameters?: Record<string, unknown> }> } };
    };
}

const host = (): HostWindow["Microsoft"] => {
    try {
        return (window as unknown as HostWindow).Microsoft ?? (window.parent as unknown as HostWindow)?.Microsoft;
    } catch {
        return undefined; // cross-origin parent
    }
};

export const cleanId = (id: string | undefined | null): string | undefined =>
    id ? id.replace(/[{}]/g, "").toLowerCase() : undefined;

/** The conversation (msdyn_ocliveworkitem) id: the form record, or the focused Omnichannel session. */
export async function getConversationId(entityTypeName?: string, entityId?: string): Promise<string | undefined> {
    if (entityTypeName === "msdyn_ocliveworkitem" && entityId) return cleanId(entityId);
    try {
        return cleanId(await host()?.Omnichannel?.getConversationId?.());
    } catch {
        return undefined;
    }
}

/** Context variables stored on the conversation, from the standard and the elastic context item tables. */
async function loadContextItems(webApi: WebApi, conversationId: string): Promise<Record<string, string>> {
    const vars: Record<string, string> = {};
    const query = `?$select=msdyn_name,msdyn_value&$filter=_msdyn_ocliveworkitemid_value eq ${conversationId}`;
    for (const table of ["msdyn_ocliveworkitemcontextitem", "msdyn_ocliveworkitemcontextitemelastic"]) {
        try {
            const result = await webApi.retrieveMultipleRecords(table, query);
            for (const row of result.entities as ContextItem[]) {
                if (row.msdyn_name && row.msdyn_value != null && !(row.msdyn_name in vars)) {
                    vars[row.msdyn_name] = String(row.msdyn_value);
                }
            }
        } catch {
            // Table missing in this org or no read privilege: try the next source.
        }
    }
    return vars;
}

/** Session context of the focused Copilot Service workspace session (fallback source). */
async function loadSessionContext(): Promise<Record<string, string>> {
    const vars: Record<string, string> = {};
    try {
        const ctx = await host()?.Apm?.getFocusedSession?.()?.getContext?.();
        for (const [k, v] of Object.entries(ctx?.parameters ?? {})) {
            if (typeof v === "string") vars[k] = v;
            else if (typeof v === "number" || typeof v === "boolean") vars[k] = v.toString();
            else if (v != null) vars[k] = JSON.stringify(v);
        }
    } catch {
        // Not running in Copilot Service workspace.
    }
    return vars;
}

/** Finds the brief: bound column first, then conversation context items, then session context, then the va_* fallback. */
export async function loadBrief(
    webApi: WebApi,
    conversationId: string | undefined,
    variableName: string,
    boundValue: string | null | undefined,
): Promise<LoadedBrief> {
    const fromBound = parseBrief(boundValue);
    const vars: Record<string, string> = conversationId ? await loadContextItems(webApi, conversationId) : {};
    const session = await loadSessionContext();
    for (const [k, v] of Object.entries(session)) if (!(k in vars)) vars[k] = v;

    if (fromBound) return { brief: fromBound, source: "brief", variables: vars };

    const key = Object.keys(vars).find((k) => k.toLowerCase() === variableName.toLowerCase());
    const brief = key ? parseBrief(vars[key]) : undefined;
    if (brief) return { brief, source: "brief", variables: vars };

    const fallback = buildFallbackBrief(vars);
    return { brief: fallback, source: fallback ? "fallback" : "none", variables: vars };
}

interface TranscriptRow {
    msdyn_commontranscriptmessageid: string;
    msdyn_content?: string;
    msdyn_role?: string;
    msdyn_messagetimestamp?: string;
}

/** Thrown when the per-message transcript table can't be read, so the caller can stop polling. */
export class TranscriptUnavailableError extends Error {}

/** Live messages for the conversation from msdyn_commontranscriptmessage (one row per message). */
export async function loadTranscript(webApi: WebApi, conversationId: string): Promise<TranscriptMessage[]> {
    const query =
        "?$select=msdyn_content,msdyn_role,msdyn_messagetimestamp" +
        `&$filter=msdyn_conversationid eq '${conversationId}'` +
        "&$orderby=msdyn_messagetimestamp asc";
    try {
        const result = await webApi.retrieveMultipleRecords("msdyn_commontranscriptmessage", query);
        return (result.entities as TranscriptRow[]).map((r) => ({
            id: r.msdyn_commontranscriptmessageid,
            role: (r.msdyn_role ?? "").toLowerCase(),
            text: messageText(r.msdyn_content),
            at: r.msdyn_messagetimestamp ?? "",
        }));
    } catch (e) {
        throw new TranscriptUnavailableError(e instanceof Error ? e.message : String(e));
    }
}

/** msdyn_content is plain text or a JSON envelope for structured messages. */
export function messageText(content: string | undefined): string {
    if (!content) return "";
    const trimmed = content.trim();
    if (!trimmed.startsWith("{")) return content;
    try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        for (const key of ["text", "content", "Text", "Content", "message"]) {
            const value = obj[key];
            if (typeof value === "string") return value;
        }
    } catch {
        // Not JSON after all.
    }
    return content;
}

const SCORE_TABLE = "zrh_handoffquality";

/** Creates or updates the Handoff Quality row for this conversation. Returns the row id. */
export async function saveScore(
    webApi: WebApi,
    conversationId: string,
    loaded: LoadedBrief,
    score: HandoffScore,
    existingId: string | undefined,
): Promise<string | undefined> {
    const row = {
        zrh_name: (loaded.brief?.reason ?? "Conversation").substring(0, 100),
        zrh_conversationid: conversationId,
        zrh_score: score.score,
        zrh_reasks: score.reAsks.length,
        zrh_reaskeditems: score.reAsks.map((r) => r.fact.k).join(", ").substring(0, 2000),
        zrh_genericopener: score.genericOpener,
        zrh_customerrepeated: score.customerRepeated,
        zrh_briefsource: loaded.source,
        zrh_factcount: loaded.brief?.facts?.length ?? 0,
    };
    try {
        let id = existingId;
        if (!id) {
            const found = await webApi.retrieveMultipleRecords(
                SCORE_TABLE,
                `?$select=zrh_handoffqualityid&$filter=zrh_conversationid eq '${conversationId}'&$top=1`,
            );
            id = (found.entities[0] as { zrh_handoffqualityid?: string } | undefined)?.zrh_handoffqualityid;
        }
        if (id) {
            await webApi.updateRecord(SCORE_TABLE, id, row);
            return id;
        }
        const created = await webApi.createRecord(SCORE_TABLE, row);
        return created.id;
    } catch {
        return existingId; // Score table not installed or no privilege: scoring stays display-only.
    }
}
