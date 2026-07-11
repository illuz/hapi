import { describe, expect, test } from 'bun:test'
import {
    CLAUDE_MODEL_PRESETS,
    CLAUDE_MODEL_LABELS,
    CODEX_MODEL_PRESETS,
    CODEX_MODEL_LABELS,
    CODEX_REASONING_EFFORT_PRESETS,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL_LABELS,
    GEMINI_MODEL_PRESETS,
    getClaudeModelLabel,
    getCodexReasoningEffortPresets,
    getCodexModelLabel,
    isClaudeModelPreset,
    supportsCodexExtendedReasoning,
} from './models'

describe('isClaudeModelPreset', () => {
    test('accepts valid presets', () => {
        for (const preset of CLAUDE_MODEL_PRESETS) {
            expect(isClaudeModelPreset(preset)).toBe(true)
        }
    })

    test('rejects unknown model string', () => {
        expect(isClaudeModelPreset('haiku')).toBe(false)
    })

    test('rejects null and undefined', () => {
        expect(isClaudeModelPreset(null)).toBe(false)
        expect(isClaudeModelPreset(undefined)).toBe(false)
    })
})

describe('getClaudeModelLabel', () => {
    test('returns label for known presets', () => {
        expect(getClaudeModelLabel('sonnet')).toBe('Sonnet')
        expect(getClaudeModelLabel('opus')).toBe('Opus')
        expect(getClaudeModelLabel('opus[1m]')).toBe('Opus 1M')
        expect(getClaudeModelLabel('fable-5')).toBe('Fable 5')
    })

    test('trims whitespace before lookup', () => {
        expect(getClaudeModelLabel('  sonnet  ')).toBe('Sonnet')
    })

    test('returns null for unknown model', () => {
        expect(getClaudeModelLabel('haiku')).toBeNull()
    })

    test('returns null for empty/whitespace-only string', () => {
        expect(getClaudeModelLabel('')).toBeNull()
        expect(getClaudeModelLabel('   ')).toBeNull()
    })
})

describe('getCodexModelLabel', () => {
    test('returns label for known presets', () => {
        expect(getCodexModelLabel('gpt-5.5')).toBe('GPT-5.5')
        expect(getCodexModelLabel('gpt-5.6-luna')).toBe('GPT-5.6 Luna')
        expect(getCodexModelLabel('gpt-5.6-sol')).toBe('GPT-5.6 Sol')
        expect(getCodexModelLabel('gpt-5.6-terra')).toBe('GPT-5.6 Terra')
    })

    test('returns null for unknown model', () => {
        expect(getCodexModelLabel('gpt-legacy')).toBeNull()
    })
})

describe('supportsCodexExtendedReasoning', () => {
    test('matches GPT-5.6 model family only', () => {
        expect(supportsCodexExtendedReasoning('gpt-5.6-luna')).toBe(true)
        expect(supportsCodexExtendedReasoning(' gpt-5.6-sol ')).toBe(true)
        expect(supportsCodexExtendedReasoning('gpt-5.5')).toBe(false)
        expect(supportsCodexExtendedReasoning(null)).toBe(false)
    })
})

describe('getCodexReasoningEffortPresets', () => {
    test('hides max and ultra for non-5.6 models', () => {
        expect(getCodexReasoningEffortPresets('gpt-5.5')).toEqual(['low', 'medium', 'high', 'xhigh'])
        expect(getCodexReasoningEffortPresets(null)).toEqual(['low', 'medium', 'high', 'xhigh'])
    })

    test('shows max and ultra for GPT-5.6 models', () => {
        expect(getCodexReasoningEffortPresets('gpt-5.6-terra')).toEqual([
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
            'ultra'
        ])
    })
})

describe('model constants consistency', () => {
    test('every CLAUDE_MODEL_PRESET has a label', () => {
        for (const preset of CLAUDE_MODEL_PRESETS) {
            expect(CLAUDE_MODEL_LABELS[preset]).toBeDefined()
        }
    })

    test('every CODEX_MODEL_PRESET has a label', () => {
        for (const preset of CODEX_MODEL_PRESETS) {
            expect(CODEX_MODEL_LABELS[preset]).toBeDefined()
        }
    })

    test('every GEMINI_MODEL_PRESET has a label', () => {
        for (const preset of GEMINI_MODEL_PRESETS) {
            expect(GEMINI_MODEL_LABELS[preset]).toBeDefined()
        }
    })

    test('DEFAULT_GEMINI_MODEL is a valid preset', () => {
        expect(GEMINI_MODEL_PRESETS).toContain(DEFAULT_GEMINI_MODEL)
    })

    test('Codex defaults use GPT-5.5 with xhigh reasoning', () => {
        expect(DEFAULT_CODEX_MODEL).toBe('gpt-5.5')
        expect(DEFAULT_CODEX_REASONING_EFFORT).toBe('xhigh')
    })

    test('Codex reasoning presets include max and ultra', () => {
        expect(CODEX_REASONING_EFFORT_PRESETS).toContain('max')
        expect(CODEX_REASONING_EFFORT_PRESETS).toContain('ultra')
    })
})
