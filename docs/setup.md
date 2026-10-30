# Setup

About an hour end to end in a fresh trial. Every step below was run against a Dynamics 365 Contact Center trial in October 2026.

## 1. Environment and tools

You need, in **one** Dataverse environment:

- Dynamics 365 Customer Service or Contact Center with a chat channel and Copilot Service workspace.
- A Copilot Studio agent connected to it (Channels → Customer engagement hub → Dynamics 365 Customer Service), on a chat workstream.

No environment yet? The [30-day Customer Service trial](https://learn.microsoft.com/dynamics365/customer-service/implement/try-customer-service) includes chat, unified routing, Copilot Service workspace and Copilot Studio. Sign up with a **work account** (with a personal email you can't edit the Copilot agent); you can extend it once by 30 days, and it expires after 14 days without activity.

Tools: Node 18+, [Power Platform CLI](https://aka.ms/PowerPlatformCLI) (`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`), and the Azure CLI for the scripts' Dataverse token:

```bash
az login --tenant <your-tenant> --allow-no-subscriptions
```

If no sign-in window appears on Windows, run it once with the broker off: `AZURE_CORE_ENABLE_BROKER_ON_WINDOWS=false az login ...`. If your tenant blocks device-code sign-in (error AADSTS530035), use `pac auth create` without `--deviceCode`.

## 2. Dataverse pieces

**Option A — import the solution.** Import `solution/ZeroRepeatHandoff_managed.zip` (Power Apps → Solutions → Import). It contains the Handoff Brief Card control and the Handoff Quality table.

**Option B — from source.**

```bash
node scripts/setup-dataverse.mjs --url https://<org>.crm.dynamics.com --workstream "<your chat workstream>"
cd pcf/HandoffBriefCard && npm install
pac auth create --environment https://<org>.crm.dynamics.com
pac pcf push --solution-unique-name ZeroRepeatHandoff
```

`setup-dataverse.mjs` creates the `zrh` publisher, the `ZeroRepeatHandoff` solution and the `zrh_handoffquality` table. `--workstream` optionally registers `zrh_HandoffBrief` and the default `va_*` variables as context variables on the workstream, which makes them usable in routing rules. (Dynamics 365 stores the variables on the conversation either way.) Re-running is safe.

The control uses the React 16.14 and Fluent UI 9.46.2 platform libraries; newer Fluent versions are rejected by some orgs at import.

## 3. Copilot Studio

```bash
node scripts/install-topics.mjs --url https://<org>.crm.dynamics.com --bot <agent schema name> --escalate
```

This creates the four topics plus the demo topic and their global variables in the agent, and points the **Escalate** system topic at *ZRH - Hand off with brief* (its old YAML is saved to `escalate-backup.yaml`). Then **publish** the agent in Copilot Studio. Prefer clicking? See [copilot-studio/README.md](../copilot-studio/README.md) for the paste-into-code-editor route.

Find the schema name in Copilot Studio → Settings → Advanced → Metadata.

## 4. Put the card on the conversation form

```bash
node scripts/add-card-to-form.mjs --url https://<org>.crm.dynamics.com
```

It adds a *Handoff brief* section at the top of the left column of the **Active Conversation** form (the one Copilot Service workspace uses for live conversations), renders the `subject` column with the card, publishes, and saves the previous form XML next to you. Options: `--form`, `--column`, `--field`, `--replace`.

By hand instead: Power Apps → Tables → Conversation → Forms → Active Conversation → add a section at the top of the left column → add the **Subject** column → Components → **Handoff Brief Card** → save and publish. The enhanced form can collapse the middle column, so don't put it there.

Security: representatives need read access to *Context item value* (`msdyn_ocliveworkitemcontextitem`) and, for live scoring, *Common transcript message* (`msdyn_commontranscriptmessage`) plus create/write on *Handoff quality* (`zrh_handoffquality`).

## 5. Try it

1. Open a page with your chat widget and start a chat: *"I can't log in, the reset email never comes."*
2. Go through the demo topic (the code is shown on screen), answer "No" when asked if the email arrived, then say *"talk to a person"*.
3. In Copilot Service workspace, accept the conversation. The card shows the brief at the top of the form.
4. Reply as the representative *"Could you give me your order number please?"*, then end the conversation.
5. Score it:

```bash
node scripts/score-conversations.mjs --url https://<org>.crm.dynamics.com --days 1
```

## If the card is empty

Open **Show variables** at the bottom of the card. It lists every context variable the card could read.

- `zrh_HandoffBrief` missing → the agent didn't reach *ZRH - Hand off with brief*, or the transfer exceeded 28 KB (look for large global variables), or the agent wasn't published after installing the topics.
- Nothing at all → the representative can't read `msdyn_ocliveworkitemcontextitem`, or the card isn't on the form the workspace uses.
- "Live re-ask check unavailable" → `msdyn_commontranscriptmessage` isn't populated in your org. Use `score-conversations.mjs`.
