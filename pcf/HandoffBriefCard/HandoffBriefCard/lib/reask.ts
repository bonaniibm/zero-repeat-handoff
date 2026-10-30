/**
 * Detects when a representative asks the customer for something the AI agent already collected,
 * and turns a post-handoff conversation into a Handoff Quality Score (0-100).
 * Pure functions with no Dataverse dependency, so the card and the batch scorer share them.
 */
import type { Fact, HandoffBrief } from "./brief";

export interface TranscriptMessage {
    id: string;
    /** msdyn_role: customer, agent (human representative), bot, system or tool. */
    role: string;
    text: string;
    at: string;
}

export interface ReAsk {
    messageId: string;
    fact: Fact;
    text: string;
}

export interface HandoffScore {
    score: number;
    reAsks: ReAsk[];
    genericOpener: boolean;
    customerRepeated: boolean;
    representativeMessages: number;
}

/** Common ways representatives ask for well-known facts, keyed by words in the fact label. */
const SYNONYMS: [RegExp, string[]][] = [
    [/e-?mail/, ["email", "e-mail", "mail address"]],
    [/order/, ["order number", "order no", "order #", "order id", "order reference"]],
    [/phone|mobile/, ["phone number", "mobile number", "contact number"]],
    [/account/, ["account number", "account id", "account no"]],
    [/birth|dob/, ["date of birth", "dob", "birthday"]],
    [/post ?code|zip/, ["postcode", "post code", "zip code", "zip"]],
    [/address/, ["address"]],
    [/^name$|full name|customer name/, ["your name", "full name", "who am i speaking"]],
    [/case|ticket/, ["case number", "ticket number", "reference number"]],
    [/serial/, ["serial number", "serial"]],
    [/device|model/, ["device", "model", "which phone"]],
];

const ASK_CUES = [
    "?", "can you", "could you", "would you", "please provide", "please share", "please send",
    "please confirm", "please tell", "what is", "what's", "whats", "may i have", "can i have",
    "can i get", "tell me", "need your", "need the", "provide your", "share your", "let me know",
];

const GENERIC_OPENERS = [
    /how (can|may|could) i (help|assist)/,
    /what can i (do|help) (for|with)/,
    /how can i be of (help|assistance)/,
    /what (seems to be|is) the (problem|issue)/,
    /what are you (calling|contacting|reaching out) about/,
];

const CUSTOMER_REPEAT = [
    /\bi (already|just) (told|said|explained|gave|answered|provided)/,
    /\bas i (already )?(said|told|mentioned|explained)/,
    /\b(told|said|gave) (that )?(to )?(the|your) (bot|assistant|chatbot|virtual agent|ai)/,
    /\bdo i (really )?have to (repeat|say|explain) (it|this|that|everything)?\s*again/,
    /\b(repeat|explain) (myself|everything|it all) again/,
];

export function normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Phrases a representative might use to ask for this fact. */
export function askPhrases(fact: Fact): string[] {
    if (fact.ask && fact.ask.length > 0) return fact.ask.map(normalize);
    const label = normalize(fact.k);
    const phrases = new Set<string>([label]);
    for (const [pattern, synonyms] of SYNONYMS) {
        if (pattern.test(label)) synonyms.forEach((s) => phrases.add(s));
    }
    return [...phrases].filter((p) => p.length >= 3);
}

function isAsking(text: string): boolean {
    return ASK_CUES.some((cue) => text.includes(cue));
}

/** Facts this representative message asks for again. Mentioning the value itself ("I see order ORD-1") is not a re-ask. */
export function findReAsks(message: TranscriptMessage, facts: Fact[]): ReAsk[] {
    const text = normalize(message.text);
    if (!text || !isAsking(text)) return [];
    return facts
        .filter((fact) => !text.includes(normalize(fact.v)))
        .filter((fact) => askPhrases(fact).some((phrase) => containsPhrase(text, phrase)))
        .map((fact) => ({ messageId: message.id, fact, text: message.text }));
}

function containsPhrase(text: string, phrase: string): boolean {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

export function isGenericOpener(text: string): boolean {
    const t = normalize(text);
    return GENERIC_OPENERS.some((r) => r.test(t));
}

export function isCustomerRepeatComplaint(text: string): boolean {
    const t = normalize(text);
    return CUSTOMER_REPEAT.some((r) => r.test(t));
}

const isRepresentative = (role: string): boolean => role === "agent";

/**
 * Scores the part of the conversation after the human representative joined.
 *   -20 per fact asked again (max -60)
 *   -15 if the first representative message is a generic "how can I help" although the brief had a reason
 *   -25 if the customer complains about repeating themselves
 */
export function scoreHandoff(messages: TranscriptMessage[], brief: HandoffBrief | undefined): HandoffScore {
    const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
    const firstRepIndex = sorted.findIndex((m) => isRepresentative(m.role));
    const afterHandoff = firstRepIndex < 0 ? [] : sorted.slice(firstRepIndex);
    const repMessages = afterHandoff.filter((m) => isRepresentative(m.role));
    const facts = brief?.facts ?? [];

    const seen = new Set<string>();
    const reAsks: ReAsk[] = [];
    for (const m of repMessages) {
        for (const r of findReAsks(m, facts)) {
            if (!seen.has(r.fact.k)) {
                seen.add(r.fact.k);
                reAsks.push(r);
            }
        }
    }

    const genericOpener = !!brief?.reason && repMessages.length > 0 && isGenericOpener(repMessages[0].text);
    const customerRepeated = afterHandoff.some((m) => m.role === "customer" && isCustomerRepeatComplaint(m.text));

    let score = 100;
    score -= Math.min(60, reAsks.length * 20);
    if (genericOpener) score -= 15;
    if (customerRepeated) score -= 25;

    return {
        score: Math.max(0, score),
        reAsks,
        genericOpener,
        customerRepeated,
        representativeMessages: repMessages.length,
    };
}
