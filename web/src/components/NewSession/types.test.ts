import { CLAUDE_MODEL_PRESETS, getClaudeModelLabel } from '@hapi/protocol'
import { describe, expect, it } from 'vitest'
import { CLAUDE_EFFORT_OPTIONS, getCodexReasoningEffortOptions, MODEL_OPTIONS } from './types'

describe('Claude model options', () => {
    it('includes 1m model options in the expected order', () => {
        expect(MODEL_OPTIONS.claude).toEqual([
            { value: 'auto', label: 'Default' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'fable-5', label: 'Fable 5' },
        ])
    })

    it('exposes friendly labels for Claude model presets', () => {
        expect(CLAUDE_MODEL_PRESETS).toEqual(['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'fable-5'])
        expect(getClaudeModelLabel('sonnet[1m]')).toBe('Sonnet 1M')
        expect(getClaudeModelLabel('opus[1m]')).toBe('Opus 1M')
        expect(getClaudeModelLabel('fable-5')).toBe('Fable 5')
    })
})

describe('Claude effort options', () => {
    it('matches supported effort presets in expected order', () => {
        expect(CLAUDE_EFFORT_OPTIONS).toEqual([
            { value: 'auto', label: 'Auto' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
            { value: 'ultra', label: 'Ultra' },
        ])
    })
})

describe('Codex reasoning options', () => {
    it('hides max and ultra for the default Codex model', () => {
        expect(getCodexReasoningEffortOptions('gpt-5.5')).toEqual([
            { value: 'default', label: 'Default' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
        ])
    })

    it('shows max and ultra for GPT-5.6 models', () => {
        expect(getCodexReasoningEffortOptions('gpt-5.6-sol')).toEqual([
            { value: 'default', label: 'Default' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
            { value: 'max', label: 'Max' },
            { value: 'ultra', label: 'Ultra' },
        ])
    })
})
