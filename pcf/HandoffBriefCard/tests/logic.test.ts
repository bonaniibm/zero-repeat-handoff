import { test } from "node:test";
import * as assert from "node:assert/strict";
import { buildFallbackBrief, humanize, parseBrief } from "../HandoffBriefCard/lib/brief";
import { findReAsks, isCustomerRepeatComplaint, isGenericOpener, scoreHandoff, type TranscriptMessage } from "../HandoffBriefCard/lib/reask";
import { messageText } from "../HandoffBriefCard/lib/dataverse";
import { demoBrief } from "../HandoffBriefCard/lib/demo";
import { parseTranscriptDocument } from "../HandoffBriefCard/lib/transcript";

const msg = (id: string, role: string, text: string, at = id): TranscriptMessage => ({ id, role, text, at });

test("parseBrief accepts a valid brief and rejects junk", () => {
    assert.equal(parseBrief(JSON.stringify(demoBrief))?.reason, demoBrief.reason);
    assert.equal(parseBrief("not json"), undefined);
    assert.equal(parseBrief('{"facts":[]}'), undefined, "reason is required");
    assert.equal(parseBrief("{broken"), undefined);
    const cleaned = parseBrief('{"reason":"x","facts":[{"k":"Email","v":""},{"k":"Order","v":"1"}]}');
    assert.deepEqual(cleaned?.facts, [{ k: "Order", v: "1" }], "empty fact values are dropped");
    const corrected = parseBrief('{"reason":"x","facts":[{"k":"Email","v":"old@x.com"},{"k":"email","v":"new@x.com"}]}');
    assert.deepEqual(corrected?.facts?.map((f) => f.v), ["new@x.com"], "latest value per label wins");
});

test("demo brief fits in one Dynamics 365 context variable", () => {
    assert.ok(JSON.stringify(demoBrief).length < 4000);
});

test("fallback brief uses default handoff variables and user variables", () => {
    const brief = buildFallbackBrief({
        va_LastTopic: "Return item",
        va_LastPhrases: "can I return my headphones",
        va_Topics: '["Greeting","Return item"]',
        va_AgentMessage: "Gift from HandoffTest",
        msdyn_ConversationId: "abc",
        OrderNumber: "ORD-1",
    });
    assert.equal(brief?.reason, '"can I return my headphones"');
    assert.equal(brief?.summary, "Gift from HandoffTest");
    assert.deepEqual(brief?.facts, [{ k: "Order number", v: "ORD-1" }]);
    assert.equal(brief?.tried?.length, 2);
    assert.equal(buildFallbackBrief({ msdyn_ConversationId: "abc" }), undefined);
});

test("humanize variable names", () => {
    assert.equal(humanize("Global.orderNumber"), "Order number");
    assert.equal(humanize("date_of_birth"), "Date of birth");
});

test("re-ask detection", () => {
    const facts = demoBrief.facts ?? [];
    assert.deepEqual(findReAsks(msg("1", "agent", "Could you give me your order number please?"), facts).map((r) => r.fact.k), ["Order number"]);
    assert.deepEqual(findReAsks(msg("2", "agent", "What's the email on the account?"), facts).map((r) => r.fact.k), ["Email"]);
    assert.equal(findReAsks(msg("3", "agent", "I can see order ORD-10482, can you confirm it?"), facts).length, 0, "quoting the value is fine");
    assert.equal(findReAsks(msg("4", "agent", "I'm resetting your password now."), facts).length, 0, "not a question");
    assert.equal(findReAsks(msg("5", "agent", "Is your phone with you?"), facts).length, 0, "unknown fact");
});

test("generic opener and customer repeat complaints", () => {
    assert.ok(isGenericOpener("Hi, thanks for waiting. How can I help you today?"));
    assert.ok(!isGenericOpener("Hi Sam, I can see the reset link didn't arrive."));
    assert.ok(isCustomerRepeatComplaint("I already told the bot that!"));
    assert.ok(isCustomerRepeatComplaint("Do I have to explain everything again?"));
    assert.ok(!isCustomerRepeatComplaint("Thanks, that worked"));
});

test("scoring ignores the AI agent part and penalises re-asks", () => {
    const bot = [msg("01", "customer", "what is your order number?"), msg("02", "bot", "What is your order number?")];
    const good = scoreHandoff([...bot, msg("03", "agent", demoBrief.opener ?? "")], demoBrief);
    assert.equal(good.score, 100);

    const bad = scoreHandoff(
        [
            ...bot,
            msg("03", "agent", "Hi, how can I help you today?"),
            msg("04", "agent", "Can I have your order number?"),
            msg("05", "customer", "I already told the bot!"),
            msg("06", "agent", "And your order number again?"),
        ],
        demoBrief,
    );
    assert.equal(bad.reAsks.length, 1, "the same fact counts once");
    assert.ok(bad.genericOpener);
    assert.ok(bad.customerRepeated);
    assert.equal(bad.score, 100 - 20 - 15 - 25);

    assert.equal(scoreHandoff(bot, demoBrief).representativeMessages, 0);
});

test("saved transcript parsing and roles", () => {
    const inner = [
        { createdDateTime: "2026-10-30T12:16:20Z", isControlMessage: false, content: "I can't log in", tags: "ChannelId-lcw,FromCustomer", from: { application: { displayName: "Customer" } } },
        { createdDateTime: "2026-10-30T12:16:21Z", isControlMessage: false, content: "What's the email?", tags: "public", from: { application: { displayName: "VRL Parcel Bot" } } },
        { createdDateTime: "2026-10-30T12:17:00Z", isControlMessage: true, content: "<addmember/>" },
        { createdDateTime: "2026-10-30T12:22:00Z", isControlMessage: false, isFromAgent: true, content: "<p>Could you give me your order number please?</p>", from: { user: { displayName: "Bonani" } } },
    ];
    const doc = JSON.stringify([{ Content: JSON.stringify(inner) }]);
    const msgs = parseTranscriptDocument(doc);
    assert.deepEqual(msgs.map((m) => m.role), ["customer", "bot", "agent"]);
    assert.equal(msgs[2].text, "Could you give me your order number please?");
    assert.equal(scoreHandoff(msgs, demoBrief).reAsks.length, 1);
    assert.deepEqual(parseTranscriptDocument("not json"), []);
});

test("real Contact Center transcript shape: bot messages are isFromAgent too", () => {
    const bot = { isFromAgent: true, from: { user: { displayName: "Copilot VRL Parcel Bot (Microsoft Copilot Studio)" } } };
    const inner = [
        { ...bot, createdDateTime: "2026-10-30T12:16:10Z", content: "Hello, I'm VRL Parcel Bot. How can I help?" },
        { createdDateTime: "2026-10-30T12:16:11Z", isFromAgent: false, tags: "ChannelId-lcw,OmnichannelContextMessage,Hidden", content: '{"EventName":"startConversation"}' },
        { createdDateTime: "2026-10-30T12:16:12Z", tags: "ChannelId-lcw,FromCustomer", content: "I can't log in", from: { application: { displayName: "Customer" } } },
        { ...bot, createdDateTime: "2026-10-30T12:16:13Z", content: "What's the email address on your account?" },
        { ...bot, createdDateTime: "2026-10-30T12:17:05Z", tags: '{"type":"Escalate","context":{}}', content: "Private message" },
        { createdDateTime: "2026-10-30T12:22:00Z", isFromAgent: true, tags: "public,client_activity_id:x", from: { user: { displayName: "Bonani" } }, content: "Hi, thanks for waiting. Could you give me your order number please?" },
    ];
    const msgs = parseTranscriptDocument(JSON.stringify([{ Content: JSON.stringify(inner) }]));
    assert.deepEqual(msgs.map((m) => m.role), ["bot", "system", "customer", "bot", "system", "agent"]);
    const score = scoreHandoff(msgs, demoBrief);
    assert.deepEqual(score.reAsks.map((r) => r.fact.k), ["Order number"], "the bot asking for the email doesn't count");
    assert.equal(score.genericOpener, false, "the bot's 'How can I help?' doesn't count");
    assert.equal(score.score, 80);
});

test("transcript content envelopes", () => {
    assert.equal(messageText("hello"), "hello");
    assert.equal(messageText('{"text":"hi there","type":"message"}'), "hi there");
    assert.equal(messageText(undefined), "");
});
