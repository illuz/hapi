export const CLAUDE_MODEL_LABELS = {
    sonnet: 'Sonnet',
    'sonnet[1m]': 'Sonnet 1M',
    opus: 'Opus',
    'opus[1m]': 'Opus 1M',
    'fable-5': 'Fable 5'
} as const

export type ClaudeModelPreset = keyof typeof CLAUDE_MODEL_LABELS
export const CLAUDE_MODEL_PRESETS = Object.keys(CLAUDE_MODEL_LABELS) as ClaudeModelPreset[]

export const CODEX_MODEL_LABELS = {
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra'
} as const

export type CodexModelPreset = keyof typeof CODEX_MODEL_LABELS
export const CODEX_MODEL_PRESETS = Object.keys(CODEX_MODEL_LABELS) as CodexModelPreset[]

export const GEMINI_MODEL_LABELS = {
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
} as const

export type GeminiModelPreset = keyof typeof GEMINI_MODEL_LABELS
export const GEMINI_MODEL_PRESETS = Object.keys(GEMINI_MODEL_LABELS) as GeminiModelPreset[]
export const DEFAULT_GEMINI_MODEL: GeminiModelPreset = 'gemini-2.5-pro'

export const DEFAULT_CODEX_MODEL = 'gpt-5.5' as const
export const DEFAULT_CODEX_REASONING_EFFORT = 'xhigh' as const
const CODEX_BASE_REASONING_EFFORT_PRESETS = ['low', 'medium', 'high', 'xhigh'] as const
const CODEX_EXTENDED_REASONING_EFFORT_PRESETS = ['max', 'ultra'] as const
export const CODEX_REASONING_EFFORT_LABELS = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max',
    ultra: 'Ultra'
} as const

export type CodexReasoningEffortPreset = keyof typeof CODEX_REASONING_EFFORT_LABELS
export const CODEX_REASONING_EFFORT_PRESETS = Object.keys(CODEX_REASONING_EFFORT_LABELS) as CodexReasoningEffortPreset[]

export function supportsCodexExtendedReasoning(model: string | null | undefined): boolean {
    const trimmedModel = model?.trim().toLowerCase()
    return Boolean(trimmedModel && trimmedModel.startsWith('gpt-5.6-'))
}

export function getCodexReasoningEffortPresets(model?: string | null): CodexReasoningEffortPreset[] {
    return supportsCodexExtendedReasoning(model)
        ? [...CODEX_BASE_REASONING_EFFORT_PRESETS, ...CODEX_EXTENDED_REASONING_EFFORT_PRESETS]
        : [...CODEX_BASE_REASONING_EFFORT_PRESETS]
}

export function isClaudeModelPreset(model: string | null | undefined): model is ClaudeModelPreset {
    return typeof model === 'string' && Object.hasOwn(CLAUDE_MODEL_LABELS, model)
}

export function getClaudeModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CLAUDE_MODEL_LABELS[trimmedModel as ClaudeModelPreset] ?? null
}

export function getCodexModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CODEX_MODEL_LABELS[trimmedModel as CodexModelPreset] ?? null
}
