# Setup

About an hour end to end in a fresh trial.

## 1. Environment

You need, in **one** Dataverse environment:

- Dynamics 365 Customer Service or Contact Center with a chat channel and Copilot Service workspace.
- A Copilot Studio agent connected to it (Channels → Customer engagement hub → Dynamics 365 Customer Service).

No environment yet? The [30-day Customer Service trial](https://learn.microsoft.com/dynamics365/customer-service/implement/try-customer-service) includes chat, unified routing, Copilot Service workspace and Copilot Studio. Sign up with a **work account** (with a personal email you can't edit the Copilot agent), and you can extend it once by 30 days. It expires after 14 days without activity.

Tools: Node 18+, [Power Platform CLI](https://aka.ms/PowerPlatformCLI) (`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`).

## 2. Dataverse pieces

**Option A — import the solution.** Import `solution/ZeroRepeatHandoff_managed.zip` (Power Apps → Solutions → Import). It contains the Handoff Brief Card control and the Handoff Quality table.

**Option B — from source.**

```bash
pac auth create --environment https://<org>.crm.dynamics.com
az login --tenant <your-tenant> --allow-no-subscriptions
node scripts/setup-dataverse.mjs --url https://<org>.crm.dynamics.com --workstream "<your chat workstream>"
cd pcf/HandoffBriefCard && npm install
pac pcf push --solution-unique-name ZeroRepeatHandoff
```

`setup-dataverse.mjs` creates the `zrh` publisher, the `ZeroRepeatHandoff` solution and the `zrh_handoffquality` table, and (with `--workstream`) registers `zrh_HandoffBrief` as a context variable on your chat workstream. Re-running it is safe.

## 3. Copilot Studio

Follow [copilot-studio/README.md](../copilot-studio/README.md): paste four topics, point Escalate at *ZRH - Hand off with brief*, publish.

## 4. Put the card on the conversation form

1. Power Apps → Tables → **Conversation** (`msdyn_ocliveworkitem`) → Forms. Open the form your Copilot Service workspace uses for active conversations (by default **Customer summary**/**Conversation** main form; check the app profile if unsure).
2. Add any text column to a section near the top (for example **Title**), hide its label.
3. Select the column → **Components → + Component → Handoff Brief Card**. Leave *Brief variable name* as `zrh_HandoffBrief`. Turn **Demo mode** off.
4. Save and publish.

Security: representatives need read access to *Context item value* (`msdyn_ocliveworkitemcontextitem`), *Common transcript message* (`msdyn_commontranscriptmessage`) and create/write on *Handoff quality* (`zrh_handoffquality`). Add these to a small role and assign it with the representative role.

## 5. Try it

1. Open the chat widget's test page and start a chat: *"I can't log in, the reset email never comes."*
2. Go through the demo topic, answer "no" when asked if the email arrived, then say *"talk to a person"*.
3. In Copilot Service workspace, accept the conversation. The card shows the brief.
4. Type *"Could you give me your order number?"* — the card warns you and shows the value.
5. Open **Handoff quality** (advanced find or a view in your app) to see the score row.

## Day-1 check if something's empty

Open **Show variables** at the bottom of the card. It lists every context variable the card could read for the conversation.

- `zrh_HandoffBrief` missing → the agent didn't reach *ZRH - Hand off with brief*, or the transfer exceeded 28 KB (check for big global variables), or the variable isn't registered on the workstream (run the setup script with `--workstream`).
- Nothing at all → the representative can't read `msdyn_ocliveworkitemcontextitem`, or the card isn't on the conversation (`msdyn_ocliveworkitem`) form.
- "Live re-ask check unavailable" → `msdyn_commontranscriptmessage` isn't readable or populated in your org. The brief still works.
