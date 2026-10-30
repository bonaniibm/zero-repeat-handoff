#!/usr/bin/env node
/**
 * Adds the Handoff Brief Card to a conversation (msdyn_ocliveworkitem) form: a new section at the top of
 * one column, holding a text column rendered by the PCF control. Re-running does nothing if it's there.
 * The form XML before the change is saved to form-<id>-backup.xml in the current folder.
 *
 * Usage:
 *   node scripts/add-card-to-form.mjs --url https://<org>.crm.dynamics.com
 *        [--form "Active Conversation"] [--column 0] [--field subject] [--tenant <tenant>] [--replace]
 *
 *   --column   0-based column of the first tab. The enhanced conversation form in Copilot Service workspace
 *              can collapse the middle column (Issue snapshot), so the default is the left column.
 *   --replace  move the card if it's already on the form
 *
 * Token: DATAVERSE_TOKEN env var, or the Azure CLI signed in to the environment's tenant.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
};
const baseUrl = (opt("url") ?? "").replace(/\/$/, "");
if (!baseUrl) {
    console.error("Usage: node scripts/add-card-to-form.mjs --url https://<org>.crm.dynamics.com");
    process.exit(1);
}
const formName = opt("form", "Active Conversation");
const columnIndex = Number(opt("column", "0"));
const field = opt("field", "subject");
const CONTROL = "zrh_ZeroRepeat.HandoffBriefCard";
const TEXT_CLASSID = "{4273EDBD-AC1D-40d3-9FB2-095C621B552D}";
const SECTION = "zrh_handoff_brief_section";

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
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.substring(0, 600)}`);
    return text ? JSON.parse(text) : {};
}

const form = (
    await call(
        "GET",
        `systemforms?$select=formid,name,formxml&$filter=objecttypecode eq 'msdyn_ocliveworkitem' and type eq 2 and name eq '${formName.replace(/'/g, "''")}'`,
    )
).value[0];
if (!form) throw new Error(`Form not found: ${formName}`);
let xml = form.formxml;
writeFileSync(`form-${form.formid}-backup.xml`, xml);
if (xml.includes(`name="${SECTION}"`)) {
    if (!argv.includes("--replace")) {
        console.log(`"${form.name}" already has the Handoff Brief Card (use --replace to move it).`);
        process.exit(0);
    }
    const start = xml.indexOf(`<section name="${SECTION}"`);
    const end = xml.indexOf("</section>", start) + "</section>".length;
    const oldId = xml.slice(start, end).match(/uniqueid="([^"]+)"/)[1];
    xml = xml.slice(0, start) + xml.slice(end);
    const d = xml.indexOf(`<controlDescription forControl="${oldId}">`);
    if (d >= 0) xml = xml.slice(0, d) + xml.slice(xml.indexOf("</controlDescription>", d) + "</controlDescription>".length);
}

const uniqueId = `{${randomUUID().toUpperCase()}}`;
const section =
    `<section name="${SECTION}" showlabel="false" showbar="false" locklevel="0" id="{${randomUUID()}}" IsUserDefined="1" layout="varwidth" columns="1" labelwidth="115" celllabelalignment="Left" celllabelposition="Left">` +
    `<labels><label description="Handoff brief" languagecode="1033" /></labels><rows><row>` +
    `<cell id="{${randomUUID()}}" showlabel="false" colspan="1" auto="false"><labels><label description="Handoff brief" languagecode="1033" /></labels>` +
    `<control id="zrh_handoffbrief_${field}" classid="${TEXT_CLASSID}" datafieldname="${field}" disabled="false" uniqueid="${uniqueId}" /></cell>` +
    `</row></rows></section>`;

// Insert as the first section of the requested column in the first tab.
const firstTabEnd = xml.indexOf("</tab>");
let columnStart = -1;
for (let i = 0, from = 0; i <= columnIndex; i++) {
    columnStart = xml.indexOf("<column ", from);
    if (columnStart < 0 || columnStart > firstTabEnd) throw new Error(`Column ${columnIndex} not found in the first tab`);
    from = columnStart + 1;
}
const sectionsStart = xml.indexOf("<sections>", columnStart) + "<sections>".length;
xml = xml.slice(0, sectionsStart) + section + xml.slice(sectionsStart);

const description =
    `<controlDescription forControl="${uniqueId}">` +
    `<customControl id="${TEXT_CLASSID}"><parameters><datafieldname>${field}</datafieldname></parameters></customControl>` +
    [0, 1, 2]
        .map((f) => `<customControl formFactor="${f}" name="${CONTROL}"><parameters><boundField>${field}</boundField></parameters></customControl>`)
        .join("") +
    `</controlDescription>`;
xml = xml.includes("<controlDescriptions>")
    ? xml.replace("<controlDescriptions>", `<controlDescriptions>${description}`)
    : xml.replace("</form>", `<controlDescriptions>${description}</controlDescriptions></form>`);

await call("PATCH", `systemforms(${form.formid})`, { formxml: xml });
await call("POST", "PublishXml", {
    ParameterXml: "<importexportxml><entities><entity>msdyn_ocliveworkitem</entity></entities></importexportxml>",
});
console.log(`Added the Handoff Brief Card to "${form.name}" and published.`);
