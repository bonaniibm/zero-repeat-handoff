import * as React from "react";
import { FluentProvider, webLightTheme, type Theme } from "@fluentui/react-components";
import { BriefCard } from "./BriefCard";
import type { LoadedBrief } from "../lib/brief";
import { scoreHandoff, type HandoffScore, type ReAsk, type TranscriptMessage } from "../lib/reask";
import { loadBrief, loadTranscript, saveScore, TranscriptUnavailableError } from "../lib/dataverse";
import { demoBotTranscript, demoBrief, demoRepresentativeTurns } from "../lib/demo";

export interface AppProps {
    webApi: ComponentFramework.WebApi;
    theme?: Theme;
    conversationId?: string;
    boundValue?: string | null;
    variableName: string;
    demoMode: boolean;
    liveCheck: boolean;
    saveScores: boolean;
    pollSeconds: number;
}

type TranscriptStatus = "live" | "unavailable" | "off" | "demo";

export const App: React.FC<AppProps> = (props) => {
    const { webApi, conversationId, variableName, demoMode, liveCheck, saveScores } = props;
    const [loaded, setLoaded] = React.useState<LoadedBrief | undefined>();
    const [messages, setMessages] = React.useState<TranscriptMessage[]>([]);
    const [status, setStatus] = React.useState<TranscriptStatus>(demoMode ? "demo" : liveCheck ? "live" : "off");
    const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
    const scoreRowId = React.useRef<string | undefined>(undefined);
    const savedRepCount = React.useRef(0);

    // 1. Load the brief once per conversation.
    React.useEffect(() => {
        let cancelled = false;
        setLoaded(undefined);
        if (demoMode) {
            setLoaded({ brief: demoBrief, source: "demo", variables: { zrh_HandoffBrief: JSON.stringify(demoBrief) } });
            return;
        }
        void loadBrief(webApi, conversationId, variableName, props.boundValue).then((result) => {
            if (!cancelled) setLoaded(result);
            return result;
        });
        return () => {
            cancelled = true;
        };
    }, [conversationId, variableName, demoMode]);

    // 2. Watch the live transcript (or play the demo script).
    React.useEffect(() => {
        if (demoMode) {
            setMessages(demoBotTranscript);
            const timers = demoRepresentativeTurns.map((turn, i) =>
                window.setTimeout(
                    () => setMessages((m) => [...m, { ...turn, at: new Date().toISOString() }]),
                    (i + 1) * 5000,
                ),
            );
            return () => timers.forEach((t) => window.clearTimeout(t));
        }
        if (!liveCheck || !conversationId) return;

        let stopped = false;
        const tick = async (): Promise<void> => {
            try {
                const rows = await loadTranscript(webApi, conversationId);
                if (!stopped) setMessages((prev) => (prev.length === rows.length ? prev : rows));
            } catch (e) {
                if (e instanceof TranscriptUnavailableError) {
                    stopped = true;
                    setStatus("unavailable");
                }
            }
        };
        void tick();
        const handle = window.setInterval(() => {
            if (!stopped) void tick();
        }, Math.max(2, props.pollSeconds) * 1000);
        return () => {
            stopped = true;
            window.clearInterval(handle);
        };
    }, [conversationId, liveCheck, demoMode, props.pollSeconds]);

    const score: HandoffScore | undefined = React.useMemo(
        () => (loaded?.brief ? scoreHandoff(messages, loaded.brief) : undefined),
        [messages, loaded],
    );

    // 3. Persist the score whenever the representative sends something new.
    React.useEffect(() => {
        if (demoMode || !saveScores || !score || !loaded || !conversationId) return;
        if (score.representativeMessages === 0 || score.representativeMessages === savedRepCount.current) return;
        savedRepCount.current = score.representativeMessages;
        void saveScore(webApi, conversationId, loaded, score, scoreRowId.current).then((id) => {
            scoreRowId.current = id;
            return id;
        });
    }, [score]);

    const nudges: ReAsk[] = (score?.reAsks ?? []).filter((r) => !dismissed.has(r.fact.k));

    return (
        <FluentProvider theme={props.theme ?? webLightTheme} style={{ width: "100%", background: "transparent" }}>
            <BriefCard
                loading={!loaded}
                brief={loaded?.brief}
                source={loaded?.source ?? "none"}
                variables={loaded?.variables ?? {}}
                score={score}
                nudges={nudges}
                transcriptStatus={status}
                onCopy={copyToClipboard}
                onDismissNudge={(n) => setDismissed((d) => new Set(d).add(n.fact.k))}
            />
        </FluentProvider>
    );
};

function copyToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
        legacyCopy(text);
    }
}

function legacyCopy(text: string): void {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
}
