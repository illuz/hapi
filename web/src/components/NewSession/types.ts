import {
    CODEX_REASONING_EFFORT_LABELS,
    GEMINI_MODEL_PRESETS,
    GEMINI_MODEL_LABELS,
    getCodexReasoningEffortPresets,
    type CodexReasoningEffortPreset,
} from '@hapi/protocol'

export type AgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
export type SessionType = 'simple' | 'worktree'
export type CodexReasoningEffort = 'default' | CodexReasoningEffortPreset
export type ClaudeEffort = 'auto' | 'medium' | 'high' | 'max' | 'ultra'

export const MODEL_OPTIONS: Record<AgentType, { value: string; label: string }[]> = {
    claude: [
        { value: 'auto', label: 'Default' },
        { value: 'opus', label: 'Opus' },
        { value: 'opus[1m]', label: 'Opus 1M' },
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'sonnet[1m]', label: 'Sonnet 1M' },
        { value: 'fable-5', label: 'Fable 5' },
    ],
    codex: [
        { value: 'auto', label: 'Default' },
    ],
    cursor: [],
    gemini: [
        { value: 'auto', label: 'Default' },
        ...GEMINI_MODEL_PRESETS.map(m => ({ value: m, label: GEMINI_MODEL_LABELS[m] })),
    ],
    opencode: [],
}

export function getCodexReasoningEffortOptions(model?: string | null): { value: CodexReasoningEffort; label: string }[] {
    return [
        { value: 'default', label: 'Default' },
        ...getCodexReasoningEffortPresets(model).map((effort) => ({
            value: effort,
            label: CODEX_REASONING_EFFORT_LABELS[effort]
        }))
    ]
}

export const CLAUDE_EFFORT_OPTIONS: { value: ClaudeEffort; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' },
    { value: 'ultra', label: 'Ultra' },
]
