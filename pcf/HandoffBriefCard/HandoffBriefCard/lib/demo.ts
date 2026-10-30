/** Demo data for the PCF test harness and for screen recordings. Mirrors /samples/handoff-brief.sample.json. */
import type { HandoffBrief } from "./brief";
import type { TranscriptMessage } from "./reask";

export const demoBrief: HandoffBrief = {
    v: 1,
    reason: "Password reset link never arrived",
    goal: "Get back into the Contoso account before tonight's order cut-off",
    summary:
        "Sam can't sign in. The AI agent verified Sam by email code and sent a reset link twice; neither arrived. Sam has a pending order ORD-10482 that ships tonight.",
    escalation: "unresolved",
    facts: [
        { k: "Name", v: "Sam Rivera" },
        { k: "Email", v: "s.rivera@fabrikam.com", ask: ["email", "e-mail address"] },
        { k: "Order number", v: "ORD-10482", ask: ["order number", "order id", "order #"] },
        { k: "Device", v: "iPhone, Contoso app 5.2" },
    ],
    verified: { status: "verified", method: "Email one-time code", at: new Date(Date.now() - 4 * 60000).toISOString() },
    tried: [
        { step: "Sent password reset link", outcome: "failed", note: "Customer says it didn't arrive (checked spam)" },
        { step: "Re-sent reset link", outcome: "failed", note: "Still not received after 5 minutes" },
    ],
    sentiment: "negative",
    urgency: "high",
    next: "Check the mail log for bounces, then reset the password manually and send a temporary code by SMS.",
    opener:
        "Hi Sam, I can see the reset link didn't arrive twice and that ORD-10482 needs to ship tonight. Let me sort out your access right now.",
};

const t = (secondsAgo: number): string => new Date(Date.now() - secondsAgo * 1000).toISOString();

/** The AI agent part of the conversation, already finished when the representative joins. */
export const demoBotTranscript: TranscriptMessage[] = [
    { id: "d1", role: "customer", text: "I can't log in and the reset email never comes", at: t(300) },
    { id: "d2", role: "bot", text: "I can help. I've sent a code to s.rivera@fabrikam.com. What is it?", at: t(290) },
    { id: "d3", role: "customer", text: "482913", at: t(270) },
    { id: "d4", role: "bot", text: "Thanks, you're verified. I've sent a reset link.", at: t(260) },
    { id: "d5", role: "customer", text: "Nothing arrived. My order ORD-10482 has to ship tonight!", at: t(120) },
    { id: "d6", role: "bot", text: "I'm connecting you to a colleague who can reset it manually.", at: t(60) },
];

/** Representative turns played back over time in demo mode, to show the re-ask nudge live. */
export const demoRepresentativeTurns: Omit<TranscriptMessage, "at">[] = [
    { id: "r1", role: "agent", text: "Hi, thanks for waiting. How can I help you today?" },
    { id: "r2", role: "agent", text: "Could you give me your order number please?" },
];
