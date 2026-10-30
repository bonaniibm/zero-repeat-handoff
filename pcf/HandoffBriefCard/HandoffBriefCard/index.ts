import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import type { Theme } from "@fluentui/react-components";
import { App, type AppProps } from "./components/App";
import { cleanId, getConversationId } from "./lib/dataverse";

/**
 * Handoff Brief card: shows a human representative what the customer already told the
 * Copilot Studio agent, nudges when the representative asks for it again, and scores the handoff.
 */
export class HandoffBriefCard implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private conversationId: string | undefined;
    private notifyOutputChanged: () => void;

    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
        this.notifyOutputChanged = notifyOutputChanged;
        const info = (context.mode as unknown as { contextInfo?: { entityId?: string; entityTypeName?: string } }).contextInfo;
        const override = cleanId(context.parameters.conversationIdOverride?.raw);
        if (override) {
            this.conversationId = override;
            return;
        }
        void getConversationId(info?.entityTypeName, info?.entityId).then((id) => {
            this.conversationId = id;
            this.notifyOutputChanged(); // re-render with the resolved id
            return id;
        });
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const p = context.parameters;
        const props: AppProps = {
            webApi: context.webAPI,
            theme: (context as unknown as { fluentDesignLanguage?: { tokenTheme?: Theme } }).fluentDesignLanguage?.tokenTheme,
            conversationId: this.conversationId,
            boundValue: p.boundField?.raw,
            variableName: p.briefVariableName?.raw?.trim() ? p.briefVariableName.raw.trim() : "zrh_HandoffBrief",
            demoMode: p.demoMode?.raw === true,
            liveCheck: p.liveReaskCheck?.raw !== false,
            saveScores: p.saveScores?.raw !== false,
            pollSeconds: p.pollSeconds?.raw ?? 4,
        };
        return React.createElement(App, props);
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        // React unmounts the tree; polling timers are cleared by effect cleanup.
    }
}
