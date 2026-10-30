# Copilot Studio part

Four topics turn whatever your agent learns into one compact **handoff brief** (`Global.zrh_HandoffBrief`), which Copilot Studio passes to Dynamics 365 as a context variable when it transfers the conversation.

| File | Topic | Called when |
|---|---|---|
| `topics/01-zrh-remember-fact.yaml` | ZRH - Remember fact | The customer gives something a person would ask for again (order number, email, account id, device). |
| `topics/02-zrh-log-step.yaml` | ZRH - Log step | The agent tries something for the customer (sent a reset link, checked an order) — with the outcome. |
| `topics/03-zrh-mark-verified.yaml` | ZRH - Mark verified | The agent has verified the customer's identity. |
| `topics/04-zrh-handoff-with-brief.yaml` | ZRH - Hand off with brief | The customer needs a person. Builds the brief, guards the size limits, transfers. |
| `topics/05-demo-reset-password.yaml` | Reset password (demo) | Optional demo scenario that uses all of the above. |

## Install

Use an agent on the **standard** harness, connected to Dynamics 365 Customer Service / Contact Center (Channels → Customer engagement hub → Dynamics 365 Customer Service), in the **same environment**.

**With the script (recommended, tested):**

```bash
node scripts/install-topics.mjs --url https://<org>.crm.dynamics.com --bot <agent schema name> --escalate
```

It creates the topics and their global variables, replaces `zrh_agent` with your agent's schema name, and points the **Escalate** system topic at the brief topic. Re-run it after editing the YAML. Then publish the agent.

**By hand:**

1. For each YAML file: **Topics → Add a topic → From blank → … → Open code editor**, replace everything with the file's content, **Save**. Name the topics exactly as in the table (schema names become `<agent>.topic.ZRHRememberFact`, etc.).
2. Replace `zrh_agent` with your agent's schema name before pasting — *Settings → Advanced → Metadata → Schema name*.
3. Open the **Escalate** system topic and replace its actions with **Go to another topic → ZRH - Hand off with brief**, so "talk to a person" requests carry a brief.
4. Publish.

**Generative orchestration on or off.** With it on, the orchestrator fills the brief's Reason, Summary, Sentiment, Urgency, Next step and Opener from the conversation. With it off, set `Global.zrh_Reason`, `zrh_Goal`, `zrh_Summary`, `zrh_Escalation`, `zrh_Sentiment`, `zrh_Urgency`, `zrh_NextStep` and `zrh_Opener` in your topics (the demo topic shows how).

## Calling the helpers from your own topics

Add a **Go to another topic** node and bind the inputs. In code view:

```yaml
- kind: BeginDialog
  id: rememberOrder
  input:
    binding:
      Label: ="Order number"
      Value: =Topic.OrderNumber
  dialog: <your agent schema name>.topic.ZRHRememberFact
```

```yaml
- kind: BeginDialog
  id: logRefund
  input:
    binding:
      Step: ="Offered a refund to the original card"
      Outcome: ="declined"
      Note: ="Customer wants store credit instead"
  dialog: <your agent schema name>.topic.ZRHLogStep
```

## Good to know

- **Limits.** One context variable value: 4,000 characters. All variables on transfer: 28 KB — above that the transfer happens **without any variables**. Copilot Studio sends *every* global and topic variable, so the hand-off topic shrinks the brief if needed and clears all its working variables before transferring.
- **Never start a variable's text with `{`.** A global whose value starts with `{` makes the next topic that reads it fail with `SystemError`. The helpers store fragments with a leading comma; the brief gets its braces only in the last assignment.
- **`messageToAgent` is a template.** Write `"{Topic.AgentMessage}"`, not `=Formula(...)`, or the representative sees the formula text.
- **Facts are never invented.** Only what your topics pass to *Remember fact* ends up in the "don't ask again" list. The orchestrator writes only the narrative parts (reason, summary, opener).
- **Never put secrets in facts** (passwords, full card numbers, one-time codes). Mask them.
- Tested end to end in a Dynamics 365 Contact Center trial (October 2026) with classic orchestration. Copilot Studio's YAML schema changes over time; if a paste fails on one node (most likely `TransferConversationV2`), add it in the designer: *Topic management → Transfer conversation*, private message `{Topic.AgentMessage}`.
