import { describe, expect, it } from 'vitest'
import { getClaudeComposerEffortOptions } from './claudeEffortOptions'

describe('getClaudeComposerEffortOptions', () => {
    it('includes the ultra preset in the default options list', () => {
        expect(getClaudeComposerEffortOptions(null)).toEqual([
            { value: null, label: 'Auto' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
            { value: 'ultra', label: 'Ultra' },
        ])
    })

    it('does not duplicate preset Claude effort values', () => {
        expect(getClaudeComposerEffortOptions('high')).toEqual([
            { value: null, label: 'Auto' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
            { value: 'ultra', label: 'Ultra' },
        ])
    })
})
