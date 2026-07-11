import { CODEX_REASONING_EFFORT_LABELS, getCodexReasoningEffortPresets, type CodexReasoningEffortPreset } from '@hapi/protocol'

export type CodexComposerReasoningEffortOption = {
    value: string | null
    label: string
}

function normalizeCodexComposerReasoningEffort(effort?: string | null): string | null {
    const trimmedEffort = effort?.trim().toLowerCase()
    if (!trimmedEffort || trimmedEffort === 'default') {
        return null
    }

    return trimmedEffort
}

function formatCodexReasoningEffortLabel(effort: string): string {
    return CODEX_REASONING_EFFORT_LABELS[effort as keyof typeof CODEX_REASONING_EFFORT_LABELS]
        ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

export function getCodexComposerReasoningEffortOptions(
    currentEffort?: string | null,
    model?: string | null
): CodexComposerReasoningEffortOption[] {
    const normalizedCurrentEffort = normalizeCodexComposerReasoningEffort(currentEffort)
    const supportedEfforts = getCodexReasoningEffortPresets(model)
    const options: CodexComposerReasoningEffortOption[] = [
        { value: null, label: 'Default' }
    ]

    if (
        normalizedCurrentEffort
        && !supportedEfforts.includes(normalizedCurrentEffort as CodexReasoningEffortPreset)
    ) {
        options.push({
            value: normalizedCurrentEffort,
            label: formatCodexReasoningEffortLabel(normalizedCurrentEffort)
        })
    }

    options.push(...supportedEfforts.map((effort) => ({
        value: effort,
        label: CODEX_REASONING_EFFORT_LABELS[effort]
    })))

    return options
}
