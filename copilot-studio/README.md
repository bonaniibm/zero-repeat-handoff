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

1. Use an agent on the **standard** harness, connected to Dynamics 365 Customer Service / Contact Center (Channels → Customer engagement hub → Dynamics 365 Customer Service), in the **same environment**.
2. Turn **generative orchestration** on (Settings → Generative AI). The hand-off topic relies on it to fill Reason, Summary, Sentiment, Urgency, Next step and Opener from the conversation.
3. For each YAML file: **Topics → Add a topic → From blank → … → Open code editor**, replace everything with the file's content, **Save**. Name the topics exactly as in the table (the schema names become `<agent>.topic.ZRHRememberFact`, etc.).
4. In `05-demo-reset-password.yaml` (and in your own topics), replace `zrh_agent` with your agent's schema name before pasting — *Settings → Advanced → Metadata → Schema name*.
5. Open the **Escalate** system topic and replace its body with a **Go to another topic → ZRH - Hand off with brief** node, so explicit "talk to a person" requests also carry a brief.
6. Publish.

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

- **Limits.** One context variable value: 4,000 characters. All variables on transfer: 28 KB — above that the transfer happens **without any variables**. The hand-off topic drops summary and steps if the brief gets too big, and clears its three working variables (`zrh_FactsJson`, `zrh_TriedJson`, `zrh_VerifiedJson`) before transferring.
- **Facts are never invented.** Only what your topics pass to *Remember fact* ends up in the "don't ask again" list. The orchestrator writes only the narrative parts (reason, summary, opener).
- **Never put secrets in facts** (passwords, full card numbers, one-time codes). Mask them.
- **Without generative orchestration** the inputs of the hand-off topic stay empty, and the brief still carries reason "Escalated by the AI agent", facts, steps and verification.
- **Not yet validated in every tenant.** Copilot Studio's YAML schema changes over time. If a paste fails on one node (most likely `TransferConversationV2`), add that node in the designer instead: *Topic management → Transfer conversation*, with the private message set to `Topic.Summary`.
