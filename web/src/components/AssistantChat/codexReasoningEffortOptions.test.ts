import { describe, expect, it } from 'vitest'
import { getCodexComposerReasoningEffortOptions } from './codexReasoningEffortOptions'

describe('getCodexComposerReasoningEffortOptions', () => {
    it('hides max and ultra for the default Codex model', () => {
        expect(getCodexComposerReasoningEffortOptions(null, 'gpt-5.5')).toEqual([
            { value: null, label: 'Default' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' }
        ])
    })

    it('shows max and ultra for GPT-5.6 models', () => {
        expect(getCodexComposerReasoningEffortOptions(null, 'gpt-5.6-terra')).toEqual([
            { value: null, label: 'Default' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
            { value: 'max', label: 'Max' },
            { value: 'ultra', label: 'Ultra' }
        ])
    })

    it('preserves non-preset current values', () => {
        expect(getCodexComposerReasoningEffortOptions('minimal', 'gpt-5.5')).toEqual([
            { value: null, label: 'Default' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' }
        ])
    })
})
