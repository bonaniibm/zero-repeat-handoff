/**
 * Handoff Brief model, parsing and the fallback built from Copilot Studio's default handoff variables.
 * Schema: /schema/handoff-brief.schema.json
 */

export type Outcome = "succeeded" | "failed" | "partial" | "declined";

export interface Fact {
    k: string;
    v: string;
    ask?: string[];
}

export interface Tried {
    step: string;
    outcome: Outcome;
    note?: string;
}

export interface HandoffBrief {
    v: 1;
    reason: string;
    goal?: string;
    summary?: string;
    escalation?: string;
    facts?: Fact[];
    verified?: { status: "verified" | "partial" | "none"; method?: string; at?: string };
    tried?: Tried[];
    sentiment?: "positive" | "neutral" | "negative";
    urgency?: "low" | "medium" | "high";
    next?: string;
    opener?: string;
}

/** Where the brief came from, so the card can say how much to trust it. */
export type BriefSource = "brief" | "fallback" | "demo" | "none";

export interface LoadedBrief {
    brief?: HandoffBrief;
    source: BriefSource;
    /** Raw context variables, shown in the "details" section and used by the fallback. */
    variables: Record<string, string>;
}

/** Dynamics 365 caps a single context variable value at 4,000 characters. */
export const MAX_VARIABLE_CHARS = 4000;

/** Parses a brief from a context variable value. Returns undefined for anything that isn't a usable brief. */
export function parseBrief(raw: string | null | undefined): HandoffBrief | undefined {
    if (!raw) return undefined;
    const text = raw.trim();
    if (!text.startsWith("{")) return undefined;
    try {
        const obj = JSON.parse(text) as Partial<HandoffBrief>;
        if (typeof obj !== "object" || obj === null || typeof obj.reason !== "string" || !obj.reason) {
            return undefined;
        }
        return {
            ...obj,
            v: 1,
            reason: obj.reason,
            facts: Array.isArray(obj.facts) ? latestPerLabel(obj.facts.filter(isFact)) : [],
            tried: Array.isArray(obj.tried) ? obj.tried.filter(isTried) : [],
        };
    } catch {
        return undefined;
    }
}

function isFact(f: unknown): f is Fact {
    const x = f as Fact;
    return !!x && typeof x.k === "string" && typeof x.v === "string" && x.v.trim() !== "";
}

/** The agent may remember the same fact twice (e.g. a corrected email); keep the latest value, in first-seen order. */
function latestPerLabel(facts: Fact[]): Fact[] {
    const byLabel = new Map<string, Fact>();
    for (const f of facts) byLabel.set(f.k.toLowerCase(), f);
    return [...byLabel.values()];
}

function isTried(t: unknown): t is Tried {
    const x = t as Tried;
    return !!x && typeof x.step === "string" && typeof x.outcome === "string";
}

/** Variables Copilot Studio or Dynamics 365 add on their own; never shown as customer facts. */
const SYSTEM_PREFIXES = ["va_", "msdyn_", "zrh_", "bot_", "activity", "conversation", "system."];

/**
 * Builds a basic brief when the agent didn't send zrh_HandoffBrief, using the variables
 * every Copilot Studio handoff carries (va_LastTopic, va_AgentMessage, va_Phrases...) plus
 * any user-defined topic variables.
 */
export function buildFallbackBrief(vars: Record<string, string>): HandoffBrief | undefined {
    const get = (name: string): string | undefined => {
        const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase());
        const value = key ? vars[key] : undefined;
        return value && value.trim() !== "" ? value.trim() : undefined;
    };

    const lastTopic = get("va_LastTopic");
    const lastPhrases = get("va_LastPhrases");
    const agentMessage = get("va_AgentMessage");
    const topics = parseList(get("va_Topics"));
    const phrases = parseList(get("va_Phrases"));

    const facts: Fact[] = Object.entries(vars)
        .filter(([k, v]) => v && v.trim() !== "" && !SYSTEM_PREFIXES.some((p) => k.toLowerCase().startsWith(p)))
        .filter(([, v]) => v.length <= 200 && !v.trim().startsWith("{") && !v.trim().startsWith("["))
        .slice(0, 15)
        .map(([k, v]) => ({ k: humanize(k), v: v.trim() }));

    if (!lastTopic && !lastPhrases && !agentMessage && facts.length === 0) return undefined;

    return {
        v: 1,
        reason: lastPhrases ? `"${lastPhrases}"` : lastTopic ?? "Escalated by the AI agent",
        summary: agentMessage,
        facts,
        tried: topics.map((t) => ({ step: `Topic: ${t}`, outcome: "partial" as Outcome })),
        next: phrases.length > 0 ? `Customer said: ${phrases.slice(-3).join(" / ")}` : undefined,
    };
}

function parseList(value: string | undefined): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).filter((s) => s.trim() !== "");
    } catch {
        // Not JSON: Dynamics 365 sometimes stores lists as comma-separated text.
    }
    return value.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/** "OrderNumber" / "order_number" / "Global.orderNumber" -> "Order number" */
export function humanize(name: string): string {
    const base = name.includes(".") ? name.substring(name.lastIndexOf(".") + 1) : name;
    const words = base
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim()
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatTime(iso: string | undefined): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const minutes = Math.round((Date.now() - d.getTime()) / 60000);
    if (minutes >= 0 && minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
    return d.toLocaleString();
}
