import * as React from "react";
import {
    Badge,
    Button,
    Caption1,
    Divider,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Subtitle2,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import { formatTime, type BriefSource, type HandoffBrief, type Tried } from "../lib/brief";
import type { HandoffScore, ReAsk } from "../lib/reask";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalM,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusLarge,
        backgroundColor: tokens.colorNeutralBackground1,
        width: "100%",
        boxSizing: "border-box",
    },
    header: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS },
    title: { marginRight: "auto" },
    reason: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightBase500 },
    muted: { color: tokens.colorNeutralForeground3 },
    section: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXS },
    sectionTitle: { textTransform: "uppercase", letterSpacing: "0.04em", color: tokens.colorNeutralForeground3 },
    opener: {
        display: "flex",
        alignItems: "flex-start",
        columnGap: tokens.spacingHorizontalS,
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorBrandBackground2,
    },
    openerText: { flexGrow: 1, fontStyle: "italic" },
    facts: { display: "grid", gridTemplateColumns: "minmax(90px, max-content) 1fr auto", columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXXS, alignItems: "center" },
    factValue: { fontWeight: tokens.fontWeightSemibold, wordBreak: "break-word" },
    tried: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalXS, margin: 0, paddingLeft: 0, listStyleType: "none" },
    triedItem: { display: "flex", columnGap: tokens.spacingHorizontalS, alignItems: "baseline" },
    noWrap: { flexShrink: 0, whiteSpace: "nowrap" },
    footer: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: tokens.spacingHorizontalS },
    details: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, whiteSpace: "pre-wrap", wordBreak: "break-all" },
});

const SOURCE_LABEL: Record<BriefSource, string> = {
    brief: "From the AI agent",
    fallback: "Basic: built from default handoff variables",
    demo: "Demo data",
    none: "",
};

const OUTCOME: Record<Tried["outcome"], { label: string; color: "success" | "danger" | "warning" | "informative" }> = {
    succeeded: { label: "Worked", color: "success" },
    failed: { label: "Didn't work", color: "danger" },
    partial: { label: "Partly", color: "warning" },
    declined: { label: "Declined", color: "informative" },
};

const ESCALATION: Record<string, string> = {
    customer_request: "Customer asked for a person",
    policy: "Policy requires a person",
    unresolved: "AI agent couldn't resolve",
    sentiment: "Customer upset",
    authentication: "Verification needed",
    high_value: "High-value customer",
};

export interface BriefCardProps {
    loading: boolean;
    brief?: HandoffBrief;
    source: BriefSource;
    variables: Record<string, string>;
    score?: HandoffScore;
    nudges: ReAsk[];
    transcriptStatus: "live" | "unavailable" | "off" | "demo";
    customerName?: string;
    onCopy: (text: string) => void;
    onDismissNudge: (nudge: ReAsk) => void;
}

export const BriefCard: React.FC<BriefCardProps> = (props) => {
    const styles = useStyles();
    const [showDetails, setShowDetails] = React.useState(false);
    const { brief, loading } = props;

    if (loading) {
        return (
            <div className={styles.root}>
                <Spinner size="tiny" label="Loading what the AI agent already knows…" />
            </div>
        );
    }

    if (!brief) {
        return (
            <div className={styles.root}>
                <Subtitle2>Handoff brief</Subtitle2>
                <Text className={styles.muted}>
                    No handoff from an AI agent on this conversation. If one is expected, check that the agent sets the
                    zrh_HandoffBrief variable before its Transfer conversation node.
                </Text>
            </div>
        );
    }

    const verified = brief.verified;
    const facts = brief.facts ?? [];
    const tried = brief.tried ?? [];

    return (
        <div className={styles.root} role="region" aria-label="Handoff brief">
            {props.nudges.map((n) => (
                <MessageBar key={n.fact.k} intent="warning" layout="multiline">
                    <MessageBarBody>
                        <MessageBarTitle>Already answered</MessageBarTitle>
                        You asked for <b>{n.fact.k.toLowerCase()}</b>. The customer already gave it to the AI agent:{" "}
                        <b>{n.fact.v}</b>
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button size="small" onClick={() => props.onCopy(n.fact.v)}>
                            Copy
                        </Button>
                        <Button size="small" appearance="transparent" onClick={() => props.onDismissNudge(n)}>
                            Dismiss
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            ))}

            <div className={styles.header}>
                <Subtitle2 className={styles.title}>Handoff brief</Subtitle2>
                {verified?.status === "verified" && (
                    <Tooltip content={`${verified.method ?? "Verified"}${verified.at ? `, ${formatTime(verified.at)}` : ""}`} relationship="description">
                        <Badge appearance="filled" color="success">Identity verified</Badge>
                    </Tooltip>
                )}
                {verified?.status === "partial" && <Badge appearance="tint" color="warning">Partly verified</Badge>}
                {verified?.status === "none" && <Badge appearance="tint" color="danger">Not verified</Badge>}
                {brief.urgency && (
                    <Badge appearance="tint" color={brief.urgency === "high" ? "danger" : brief.urgency === "medium" ? "warning" : "informative"}>
                        {brief.urgency} urgency
                    </Badge>
                )}
                {brief.sentiment && brief.sentiment !== "neutral" && (
                    <Badge appearance="tint" color={brief.sentiment === "negative" ? "danger" : "success"}>
                        {brief.sentiment === "negative" ? "Frustrated" : "Positive"}
                    </Badge>
                )}
            </div>

            <div className={styles.section}>
                <Text className={styles.reason}>{brief.reason}</Text>
                {brief.goal && <Text>Wants: {brief.goal}</Text>}
                {brief.escalation && <Caption1 className={styles.muted}>Handed over because: {ESCALATION[brief.escalation] ?? brief.escalation}</Caption1>}
            </div>

            {brief.opener && (
                <div className={styles.opener}>
                    <Text className={styles.openerText}>“{brief.opener}”</Text>
                    <Button size="small" appearance="primary" onClick={() => props.onCopy(brief.opener ?? "")}>
                        Copy opener
                    </Button>
                </div>
            )}

            {facts.length > 0 && (
                <div className={styles.section}>
                    <Caption1 className={styles.sectionTitle}>Already told the AI agent — don&apos;t ask again</Caption1>
                    <div className={styles.facts}>
                        {facts.map((f) => (
                            <React.Fragment key={f.k}>
                                <Text className={styles.muted}>{f.k}</Text>
                                <Text className={styles.factValue}>{f.v}</Text>
                                <Button size="small" appearance="subtle" aria-label={`Copy ${f.k}`} onClick={() => props.onCopy(f.v)}>
                                    Copy
                                </Button>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}

            {tried.length > 0 && (
                <div className={styles.section}>
                    <Caption1 className={styles.sectionTitle}>Already tried</Caption1>
                    <ul className={styles.tried}>
                        {tried.map((t, i) => (
                            <li key={i} className={styles.triedItem}>
                                <Badge className={styles.noWrap} size="small" appearance="tint" color={OUTCOME[t.outcome]?.color ?? "informative"}>
                                    {OUTCOME[t.outcome]?.label ?? t.outcome}
                                </Badge>
                                <Text>
                                    {t.step}
                                    {t.note && <span className={styles.muted}> — {t.note}</span>}
                                </Text>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(!!brief.summary || !!brief.next) && (
                <div className={styles.section}>
                    {brief.summary && <Text>{brief.summary}</Text>}
                    {brief.next && (
                        <Text>
                            <b>Suggested next step:</b> {brief.next}
                        </Text>
                    )}
                </div>
            )}

            <Divider />
            <div className={styles.footer}>
                <Caption1 className={styles.muted}>{SOURCE_LABEL[props.source]}</Caption1>
                {props.score && props.score.representativeMessages > 0 && (
                    <Tooltip
                        relationship="description"
                        content={`${props.score.reAsks.length} re-asked fact(s)${props.score.genericOpener ? ", generic opener" : ""}${props.score.customerRepeated ? ", customer said they repeated themselves" : ""}`}
                    >
                        <Badge appearance="outline" color={props.score.score >= 80 ? "success" : props.score.score >= 50 ? "warning" : "danger"}>
                            Handoff score {props.score.score}
                        </Badge>
                    </Tooltip>
                )}
                {props.transcriptStatus === "unavailable" && <Caption1 className={styles.muted}>· Live re-ask check unavailable</Caption1>}
                <Button size="small" appearance="transparent" onClick={() => setShowDetails(!showDetails)}>
                    {showDetails ? "Hide variables" : "Show variables"}
                </Button>
            </div>
            {showDetails && (
                <Text className={styles.details}>
                    {Object.keys(props.variables).length === 0
                        ? "No context variables found."
                        : Object.entries(props.variables)
                              .map(([k, v]) => `${k} = ${v.length > 300 ? v.substring(0, 300) + "…" : v}`)
                              .join("\n")}
                </Text>
            )}
        </div>
    );
};
