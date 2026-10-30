#!/usr/bin/env node
/**
 * Installs the Zero-Repeat Handoff topics into an existing Copilot Studio agent through the Dataverse
 * Web API (the same botcomponent records the Copilot Studio code editor saves). Re-running updates them.
 *
 * Usage:
 *   node scripts/install-topics.mjs --url https://<org>.crm.dynamics.com --bot <agent schema name>
 *        [--tenant <tenant>] [--escalate] [--no-demo] [--publish]
 *
 *   --escalate  replace the actions of the agent's Escalate system topic with a call to the brief topic
 *               (its trigger phrases are kept; the previous YAML is saved to escalate-backup.yaml)
 *   --publish   publish the agent when done (otherwise publish from Copilot Studio)
 *
 * Token: DATAVERSE_TOKEN env var, or the Azure CLI signed in to the environment's tenant.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};

const baseUrl = (opt("url") ?? "").replace(/\/$/, "");
const botName = opt("bot");
if (!baseUrl || !botName) {
    console.error("Usage: node scripts/install-topics.mjs --url https://<org>.crm.dynamics.com --bot <agent schema name>");
    process.exit(1);
}
const api = `${baseUrl}/api/data/v9.2`;
const topicsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "copilot-studio", "topics");

const token =
    process.env.DATAVERSE_TOKEN ??
    execSync(`az account get-access-token --resource ${baseUrl}${opt("tenant") ? ` --tenant ${opt("tenant")}` : ""} --query accessToken -o tsv`, {
        encoding: "utf8",
    }).trim();

async function call(method, path, body) {
    const res = await fetch(`${api}/${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
            Accept: "application/json",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.substring(0, 600)}`);
    return text ? JSON.parse(text) : {};
}

const TOPICS = [
    ["01-zrh-remember-fact.yaml", "ZRHRememberFact", "ZRH - Remember fact"],
    ["02-zrh-log-step.yaml", "ZRHLogStep", "ZRH - Log step"],
    ["03-zrh-mark-verified.yaml", "ZRHMarkVerified", "ZRH - Mark verified"],
    ["04-zrh-handoff-with-brief.yaml", "ZRHHandoffWithBrief", "ZRH - Hand off with brief"],
    ["05-demo-reset-password.yaml", "ZRHDemoResetPassword", "Reset password (demo)"],
];

const isGuid = /^[0-9a-f-]{36}$/i.test(botName);
const bot = (
    await call("GET", `bots?$select=botid,schemaname,name&$filter=${isGuid ? `botid eq ${botName}` : `schemaname eq '${botName}'`}`)
).value[0];
if (!bot) throw new Error(`Agent not found: ${botName}`);
console.log(`Agent: ${bot.name} (${bot.schemaname})`);

async function upsertTopic(schemaname, name, data) {
    const existing = (await call("GET", `botcomponents?$select=botcomponentid&$filter=schemaname eq '${schemaname}'`)).value[0];
    if (existing) {
        await call("PATCH", `botcomponents(${existing.botcomponentid})`, { data, name });
        console.log(`  updated ${name}`);
    } else {
        await call("POST", "botcomponents", {
            name,
            schemaname,
            componenttype: 9, // Topic (V2)
            data,
            "parentbotid@odata.bind": `/bots(${bot.botid})`,
        });
        console.log(`  created ${name}`);
    }
}

/**
 * Global variables are separate components (type 12). The Copilot Studio editor creates them when you save a
 * topic; records created through the API don't get them, and the agent then fails with SystemError at runtime.
 */
const GLOBALS = [
    "zrh_HandoffBrief", "zrh_FactsJson", "zrh_TriedJson", "zrh_VerifiedStatus", "zrh_VerifiedMethod", "zrh_VerifiedAt",
    "zrh_Reason", "zrh_Goal", "zrh_Summary", "zrh_Escalation", "zrh_Sentiment", "zrh_Urgency", "zrh_NextStep", "zrh_Opener",
];

for (const variable of GLOBALS) {
    const schemaname = `${bot.schemaname}.GlobalVariableComponent.${variable}`;
    const data =
        "kind: Variable\n" +
        `name: ${variable}\n` +
        "scope: Conversation\n" +
        "isExternalInitializationAllowed: false\n" +
        "isOutputToExternalCallers: false\n" +
        "initializationTimeoutInMilliseconds: 0\n";
    const existing = (await call("GET", `botcomponents?$select=botcomponentid,data&$filter=schemaname eq '${schemaname}'`)).value[0];
    if (existing) {
        if (existing.data !== data) await call("PATCH", `botcomponents(${existing.botcomponentid})`, { data });
        continue;
    }
    await call("POST", "botcomponents", {
        name: variable,
        schemaname,
        componenttype: 12, // Global variable
        data,
        "parentbotid@odata.bind": `/bots(${bot.botid})`,
    });
    console.log(`  created global variable ${variable}`);
}

for (const [file, suffix, name] of TOPICS) {
    if (flag("no-demo") && suffix === "ZRHDemoResetPassword") continue;
    const yaml = readFileSync(join(topicsDir, file), "utf8").replaceAll("zrh_agent", bot.schemaname);
    await upsertTopic(`${bot.schemaname}.topic.${suffix}`, name, yaml);
}

if (flag("escalate")) {
    const escalate = (
        await call("GET", `botcomponents?$select=botcomponentid,data&$filter=schemaname eq '${bot.schemaname}.topic.Escalate'`)
    ).value[0];
    if (!escalate) throw new Error("Escalate system topic not found");
    if (escalate.data.includes(".topic.ZRHHandoffWithBrief")) {
        console.log("  Escalate already calls the brief topic");
    } else {
        writeFileSync("escalate-backup.yaml", escalate.data);
        const head = escalate.data.substring(0, escalate.data.indexOf("\n  actions:"));
        const data =
            `${head}\n  actions:\n` +
            "    - kind: BeginDialog\n" +
            "      id: zrhEscalateWithBrief\n" +
            `      dialog: ${bot.schemaname}.topic.ZRHHandoffWithBrief\n`;
        await call("PATCH", `botcomponents(${escalate.botcomponentid})`, { data });
        console.log("  Escalate now hands off with a brief (previous version in escalate-backup.yaml)");
    }
}

if (flag("publish")) {
    await call("POST", `bots(${bot.botid})/Microsoft.Dynamics.CRM.PvaPublish`, {});
    console.log("Published the agent.");
} else {
    console.log("Done. Publish the agent in Copilot Studio to make the topics live.");
}
