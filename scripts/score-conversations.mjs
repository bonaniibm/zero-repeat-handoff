#!/usr/bin/env node
/**
 * Scores closed conversations: did the customer have to repeat themselves after the AI agent handed off?
 * Reads the brief (conversation context items) and the saved transcript (annotation on msdyn_transcript),
 * scores with the same logic as the Handoff Brief card, and upserts one zrh_handoffquality row each.
 * Use it where the live transcript table isn't populated, and to score history (with or without a brief).
 *
 * Usage:
 *   node scripts/score-conversations.mjs --url https://<org>.crm.dynamics.com [--days 7] [--tenant <tenant>] [--dry-run]
 *
 * Token: DATAVERSE_TOKEN env var, or the Azure CLI signed in to the environment's tenant.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
};
const baseUrl = (opt("url") ?? "").replace(/\/$/, "");
if (!baseUrl) {
    console.error("Usage: node scripts/score-conversations.mjs --url https://<org>.crm.dynamics.com [--days 7]");
    process.exit(1);
}
const days = Number(opt("days", "7"));
const dryRun = argv.includes("--dry-run");

// Shared logic, compiled from the PCF project (npm run build:lib).
const pcfDir = join(dirname(fileURLToPath(import.meta.url)), "..", "pcf", "HandoffBriefCard");
const libDir = join(pcfDir, "out", "tests", "HandoffBriefCard", "lib");
if (!existsSync(join(libDir, "reask.js"))) execSync("npm run build:lib", { cwd: pcfDir, stdio: "inherit" });
const require = createRequire(import.meta.url);
const { scoreHandoff } = require(join(libDir, "reask.js"));
const { parseBrief, buildFallbackBrief } = require(join(libDir, "brief.js"));
const { parseTranscriptDocument } = require(join(libDir, "transcript.js"));

const api = `${baseUrl}/api/data/v9.2`;
const token =
    process.env.DATAVERSE_TOKEN ??
    execSync(`az account get-access-token --resource ${baseUrl}${opt("tenant") ? ` --tenant ${opt("tenant")}` : ""} --query accessToken -o tsv`, {
        encoding: "utf8",
    }).trim();

async function call(method, path, body) {
    const res = await fetch(`${api}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.substring(0, 400)}`);
    return text ? JSON.parse(text) : {};
}

const since = new Date(Date.now() - days * 86400000).toISOString();
const conversations = (
    await call(
        "GET",
        `msdyn_ocliveworkitems?$select=activityid,subject,createdon&$filter=statecode eq 1 and createdon ge ${since}&$orderby=createdon desc`,
    )
).value;
console.log(`${conversations.length} closed conversation(s) since ${since.substring(0, 10)}`);

let scored = 0;
for (const conv of conversations) {
    const id = conv.activityid;
    const items = (
        await call("GET", `msdyn_ocliveworkitemcontextitems?$select=msdyn_name,msdyn_value&$filter=_msdyn_ocliveworkitemid_value eq ${id}`)
    ).value;
    const vars = Object.fromEntries(items.map((i) => [i.msdyn_name, i.msdyn_value ?? ""]));
    if (!vars.va_BotId && !vars.va_Scope) continue; // never handled by an AI agent: nothing to score

    const briefKey = Object.keys(vars).find((k) => k.toLowerCase() === "zrh_handoffbrief");
    let brief = briefKey ? parseBrief(vars[briefKey]) : undefined;
    const source = brief ? "brief" : (brief = buildFallbackBrief(vars)) ? "fallback" : "none";

    const transcript = (await call("GET", `msdyn_transcripts?$select=msdyn_transcriptid&$filter=_msdyn_liveworkitemidid_value eq ${id}`)).value[0];
    if (!transcript) continue;
    const note = (await call("GET", `annotations?$select=documentbody&$filter=_objectid_value eq ${transcript.msdyn_transcriptid}`)).value[0];
    if (!note?.documentbody) continue;
    const messages = parseTranscriptDocument(Buffer.from(note.documentbody, "base64").toString("utf8"));

    const score = scoreHandoff(messages, brief);
    if (score.representativeMessages === 0) continue; // the human never wrote anything
    const row = {
        zrh_name: (brief?.reason ?? conv.subject ?? "Conversation").substring(0, 100),
        zrh_conversationid: id,
        zrh_score: score.score,
        zrh_reasks: score.reAsks.length,
        zrh_reaskeditems: score.reAsks.map((r) => r.fact.k).join(", ").substring(0, 2000),
        zrh_genericopener: score.genericOpener,
        zrh_customerrepeated: score.customerRepeated,
        zrh_briefsource: source,
        zrh_factcount: brief?.facts?.length ?? 0,
    };
    console.log(
        `${id}  score ${String(score.score).padStart(3)}  re-asked: ${row.zrh_reaskeditems || "-"}  generic opener: ${score.genericOpener ? "yes" : "no"}  brief: ${source}`,
    );
    if (!dryRun) {
        const existing = (await call("GET", `zrh_handoffqualities?$select=zrh_handoffqualityid&$filter=zrh_conversationid eq '${id}'`)).value[0];
        if (existing) await call("PATCH", `zrh_handoffqualities(${existing.zrh_handoffqualityid})`, row);
        else await call("POST", "zrh_handoffqualities", row);
    }
    scored++;
}
console.log(`${dryRun ? "Would score" : "Scored"} ${scored} handoff(s).`);
