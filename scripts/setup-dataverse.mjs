#!/usr/bin/env node
/**
 * Creates the Dataverse pieces of Zero-Repeat Handoff in an environment:
 *   - publisher "zrh" and unmanaged solution "ZeroRepeatHandoff"
 *   - table zrh_handoffquality (one row per conversation, written by the Handoff Brief card)
 *   - optionally, the zrh_HandoffBrief context variable on a workstream
 * Safe to re-run: existing items are left alone.
 *
 * Usage:
 *   node scripts/setup-dataverse.mjs --url https://<org>.crm.dynamics.com [--workstream <name or id>]
 *
 * Token: DATAVERSE_TOKEN env var, or the Azure CLI signed in to the environment's tenant:
 *   az login --tenant <tenant> --allow-no-subscriptions
 */
import { execSync } from "node:child_process";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const baseUrl = (args.url ?? process.env.DATAVERSE_URL ?? "").replace(/\/$/, "");
if (!baseUrl) {
    console.error("Missing --url https://<org>.crm.dynamics.com");
    process.exit(1);
}
const api = `${baseUrl}/api/data/v9.2`;
const SOLUTION = "ZeroRepeatHandoff";
const PREFIX = "zrh";

function getToken() {
    if (process.env.DATAVERSE_TOKEN) return process.env.DATAVERSE_TOKEN;
    const tenant = args.tenant ? ` --tenant ${args.tenant}` : "";
    return execSync(`az account get-access-token --resource ${baseUrl}${tenant} --query accessToken -o tsv`, {
        encoding: "utf8",
    }).trim();
}
const token = getToken();

async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(path.startsWith("http") ? path : `${api}/${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
            Accept: "application/json",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
            ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.substring(0, 500)}`);
    return text ? JSON.parse(text) : { location: res.headers.get("OData-EntityId") };
}

const label = (text) => ({ LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: 1033 }] });
const inSolution = { "MSCRM.SolutionUniqueName": SOLUTION };

async function ensurePublisherAndSolution() {
    let pub = (await call("GET", `publishers?$select=publisherid&$filter=uniquename eq 'zerorepeat'`)).value[0];
    if (!pub) {
        await call("POST", "publishers", {
            uniquename: "zerorepeat",
            friendlyname: "Zero-Repeat Handoff",
            customizationprefix: PREFIX,
            customizationoptionvalueprefix: 47_310,
            description: "https://github.com/bonaniibm/zero-repeat-handoff",
        });
        pub = (await call("GET", `publishers?$select=publisherid&$filter=uniquename eq 'zerorepeat'`)).value[0];
        console.log("Created publisher zerorepeat (prefix zrh)");
    }
    const sol = (await call("GET", `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION}'`)).value[0];
    if (!sol) {
        await call("POST", "solutions", {
            uniquename: SOLUTION,
            friendlyname: "Zero-Repeat Handoff",
            version: "1.0.0.0",
            description: "Handoff Brief card, Handoff Quality table. https://github.com/bonaniibm/zero-repeat-handoff",
            "publisherid@odata.bind": `/publishers(${pub.publisherid})`,
        });
        console.log(`Created solution ${SOLUTION}`);
    }
}

async function tableExists(logicalName) {
    try {
        await call("GET", `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName`);
        return true;
    } catch {
        return false;
    }
}

async function columnExists(table, column) {
    try {
        await call("GET", `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${column}')?$select=LogicalName`);
        return true;
    } catch {
        return false;
    }
}

const string = (schema, display, max, description) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
    SchemaName: schema, DisplayName: label(display), Description: label(description),
    RequiredLevel: { Value: "None" }, MaxLength: max, FormatName: { Value: "Text" },
});
const memo = (schema, display, max, description) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
    SchemaName: schema, DisplayName: label(display), Description: label(description),
    RequiredLevel: { Value: "None" }, MaxLength: max, Format: "TextArea",
});
const whole = (schema, display, min, max, description) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
    SchemaName: schema, DisplayName: label(display), Description: label(description),
    RequiredLevel: { Value: "None" }, MinValue: min, MaxValue: max, Format: "None",
});
const yesNo = (schema, display, description) => ({
    "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
    SchemaName: schema, DisplayName: label(display), Description: label(description),
    RequiredLevel: { Value: "None" }, DefaultValue: false,
    OptionSet: {
        TrueOption: { Value: 1, Label: label("Yes") },
        FalseOption: { Value: 0, Label: label("No") },
    },
});

const TABLE = "zrh_handoffquality";
const COLUMNS = [
    string("zrh_conversationid", "Conversation id", 100, "msdyn_ocliveworkitem id of the conversation."),
    whole("zrh_score", "Handoff score", 0, 100, "100 = the customer never had to repeat themselves."),
    whole("zrh_reasks", "Re-asked facts", 0, 1000, "Facts the representative asked for again although the AI agent had them."),
    memo("zrh_reaskeditems", "Re-asked items", 2000, "Labels of the re-asked facts."),
    yesNo("zrh_genericopener", "Generic opener", "First representative message was a generic 'How can I help?' although the brief had a reason."),
    yesNo("zrh_customerrepeated", "Customer complained about repeating", "The customer said they already told the AI agent."),
    string("zrh_briefsource", "Brief source", 20, "brief, fallback or none."),
    whole("zrh_factcount", "Facts in brief", 0, 1000, "How many facts the AI agent handed over."),
];

async function ensureTable() {
    if (!(await tableExists(TABLE))) {
        await call(
            "POST",
            "EntityDefinitions",
            {
                "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
                SchemaName: "zrh_HandoffQuality",
                DisplayName: label("Handoff quality"),
                DisplayCollectionName: label("Handoff quality"),
                Description: label("One row per conversation: did the customer have to repeat themselves after the AI agent handed off?"),
                OwnershipType: "UserOwned",
                HasActivities: false,
                HasNotes: false,
                IsActivity: false,
                Attributes: [
                    {
                        ...string("zrh_Name", "Reason", 100, "Reason for contact from the brief."),
                        IsPrimaryName: true,
                        RequiredLevel: { Value: "None" },
                    },
                ],
            },
            inSolution,
        );
        console.log(`Created table ${TABLE}`);
    }
    for (const column of COLUMNS) {
        const logical = column.SchemaName.toLowerCase();
        if (!(await columnExists(TABLE, logical))) {
            await call("POST", `EntityDefinitions(LogicalName='${TABLE}')/Attributes`, column, inSolution);
            console.log(`  + ${logical}`);
        }
    }
}

/**
 * Variables registered on the workstream. Dynamics 365 only saves a variable the agent sends on transfer
 * (as a context item on the conversation) when it's registered here, so the card can read it later.
 * The va_* ones feed the card's fallback brief for agents that don't send zrh_HandoffBrief.
 */
const CONTEXT_VARIABLES = [
    ["zrh_HandoffBrief", "Handoff brief"],
    ["va_LastTopic", "AI agent: last topic"],
    ["va_LastPhrases", "AI agent: last customer phrase"],
    ["va_Phrases", "AI agent: customer phrases"],
    ["va_Topics", "AI agent: topics"],
    ["va_AgentMessage", "AI agent: message to representative"],
];

async function ensureContextVariables(workstream) {
    const isGuid = /^[0-9a-f-]{36}$/i.test(workstream);
    const ws = (
        await call(
            "GET",
            `msdyn_liveworkstreams?$select=msdyn_liveworkstreamid,msdyn_name&$filter=${isGuid ? `msdyn_liveworkstreamid eq ${workstream}` : `msdyn_name eq '${workstream.replace(/'/g, "''")}'`}`,
        )
    ).value[0];
    if (!ws) throw new Error(`Workstream not found: ${workstream}`);
    const existing = new Set(
        (
            await call(
                "GET",
                `msdyn_ocliveworkstreamcontextvariables?$select=msdyn_name&$filter=_msdyn_liveworkstreamid_value eq ${ws.msdyn_liveworkstreamid}`,
            )
        ).value.map((v) => v.msdyn_name.toLowerCase()),
    );
    // Look up the "Text" option of msdyn_datatype instead of hard-coding its value.
    const meta = await call(
        "GET",
        "EntityDefinitions(LogicalName='msdyn_ocliveworkstreamcontextvariable')/Attributes(LogicalName='msdyn_datatype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)",
    );
    const textOption = meta.OptionSet.Options.find((o) =>
        o.Label?.LocalizedLabels?.some((l) => /^(text|string)$/i.test(l.Label)),
    );
    if (!textOption) throw new Error("Couldn't find the Text option of msdyn_datatype");
    const textType = textOption.Value;
    for (const [name, display] of CONTEXT_VARIABLES) {
        if (existing.has(name.toLowerCase())) {
            console.log(`Context variable ${name} already on "${ws.msdyn_name}"`);
            continue;
        }
        await call("POST", "msdyn_ocliveworkstreamcontextvariables", {
            msdyn_name: name,
            msdyn_displayname: display,
            msdyn_datatype: textType,
            msdyn_isdisplayable: false,
            "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${ws.msdyn_liveworkstreamid})`,
        });
        console.log(`Added context variable ${name} to workstream "${ws.msdyn_name}"`);
    }
}

await ensurePublisherAndSolution();
await ensureTable();
if (args.workstream) await ensureContextVariables(args.workstream);
await call("POST", "PublishAllXml", {});
console.log("Done. Published customizations.");
