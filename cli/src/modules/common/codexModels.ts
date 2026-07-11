import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import { getErrorMessage } from './rpcResponses';
import { getNonOriginatingCodexClientInfo } from '@/codex/utils/appServerClientInfo';
import { CODEX_MODEL_PRESETS, DEFAULT_CODEX_MODEL, getCodexModelLabel } from '@hapi/protocol';

const FILTERED_CODEX_MODEL_IDS = new Set([
    'gpt-5.2',
    'gpt-5.3-codex',
    'gpt-5.4-mini'
]);

export interface CodexModelSummary {
    id: string;
    displayName: string;
    isDefault: boolean;
    defaultReasoningEffort?: string | null;
    supportedReasoningEfforts?: string[];
}

export interface ListCodexModelsRequest {
    includeHidden?: boolean;
}

export interface ListCodexModelsResponse {
    success: boolean;
    models?: CodexModelSummary[];
    error?: string;
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSupportedReasoningEfforts(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const efforts = value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const reasoningEffort = asNonEmptyString((entry as { reasoningEffort?: unknown }).reasoningEffort);
            return reasoningEffort;
        })
        .filter((entry): entry is string => entry !== null);

    return efforts.length > 0 ? efforts : undefined;
}

function normalizeModel(entry: unknown): CodexModelSummary | null {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const record = entry as Record<string, unknown>;
    const id = asNonEmptyString(record.id) ?? asNonEmptyString(record.model);
    if (!id || FILTERED_CODEX_MODEL_IDS.has(id)) {
        return null;
    }

    return {
        id,
        displayName: asNonEmptyString(record.displayName) ?? getCodexModelLabel(id) ?? id,
        isDefault: record.isDefault === true,
        defaultReasoningEffort: asNonEmptyString(record.defaultReasoningEffort),
        supportedReasoningEfforts: normalizeSupportedReasoningEfforts(record.supportedReasoningEfforts)
    };
}

function mergeKnownCodexModels(models: CodexModelSummary[]): CodexModelSummary[] {
    const merged = [...models];

    for (const modelId of CODEX_MODEL_PRESETS) {
        if (merged.some((model) => model.id === modelId)) {
            continue;
        }

        merged.push({
            id: modelId,
            displayName: getCodexModelLabel(modelId) ?? modelId,
            isDefault: modelId === DEFAULT_CODEX_MODEL
        });
    }

    return merged;
}

export async function listCodexModels(includeHidden: boolean = false): Promise<CodexModelSummary[]> {
    const client = new CodexAppServerClient();

    try {
        await client.connect();
        await client.initialize({
            clientInfo: getNonOriginatingCodexClientInfo(),
            capabilities: {
                experimentalApi: true
            }
        });

        const response = await client.listModels({ includeHidden });
        const models = Array.isArray(response.data)
            ? response.data.map(normalizeModel).filter((model): model is CodexModelSummary => model !== null)
            : [];

        return mergeKnownCodexModels(models);
    } catch (error) {
        throw new Error(getErrorMessage(error, 'Failed to list Codex models'));
    } finally {
        await client.disconnect().catch(() => undefined);
    }
}
