import { describe, expect, it } from 'vitest'

import { mergeCodexModelOptions } from './codexModelOptions'

describe('mergeCodexModelOptions', () => {
    it('prefers discovered metadata and adds custom models', () => {
        expect(mergeCodexModelOptions([
            { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
        ], [
            { id: 'gpt-5.5', displayName: 'Custom label', supportedReasoningEfforts: [] },
            { id: 'gpt-6-astra', displayName: null, supportedReasoningEfforts: [] }
        ])).toEqual([
            {
                value: 'gpt-5.5',
                label: 'GPT-5.5',
                supportedReasoningEfforts: undefined
            },
            {
                value: 'gpt-6-astra',
                label: 'gpt-6-astra',
                supportedReasoningEfforts: undefined
            }
        ])
    })

    it('ignores blank IDs and duplicate custom entries', () => {
        expect(mergeCodexModelOptions([], [
            { id: ' ', displayName: 'blank', supportedReasoningEfforts: [] },
            { id: 'gpt-6-astra', displayName: 'Astra', supportedReasoningEfforts: [] },
            { id: 'gpt-6-astra', displayName: 'Astra 2', supportedReasoningEfforts: [] }
        ])).toEqual([
            {
                value: 'gpt-6-astra',
                label: 'Astra',
                supportedReasoningEfforts: undefined
            }
        ])
    })

    it('keeps discovered reasoning metadata when a custom model has the same ID', () => {
        expect(mergeCodexModelOptions([
            {
                id: 'gpt-6-astra',
                displayName: 'GPT-6 Astra',
                isDefault: false,
                supportedReasoningEfforts: ['minimal', 'high', 'ultra']
            }
        ], [
            {
                id: 'gpt-6-astra',
                displayName: 'Custom Astra',
                supportedReasoningEfforts: ['low']
            }
        ])).toEqual([
            {
                value: 'gpt-6-astra',
                label: 'GPT-6 Astra',
                supportedReasoningEfforts: ['minimal', 'high', 'ultra']
            }
        ])
    })
})
