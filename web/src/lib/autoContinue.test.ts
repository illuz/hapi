import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatBlock } from '@/chat/types'
import {
    AUTO_CONTINUE_DEFAULT_KEYWORDS,
    AUTO_CONTINUE_DEFAULT_PROMPT,
    AUTO_CONTINUE_DEFAULT_REMAINING,
    getLastAssistantLines,
    loadAutoContinueState,
    normalizeAutoContinueKeywords,
    normalizeAutoContinuePrompt,
    saveAutoContinueState,
    shouldAutoContinue
} from './autoContinue'

describe('autoContinue', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('loads disabled defaults when storage is empty', () => {
        expect(loadAutoContinueState('session-1')).toEqual({
            enabled: false,
            remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
            maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
            keywords: AUTO_CONTINUE_DEFAULT_KEYWORDS,
            prompt: AUTO_CONTINUE_DEFAULT_PROMPT
        })
    })

    it('persists enabled state, count, keywords, and prompt', () => {
        saveAutoContinueState('session-1', {
            enabled: true,
            remaining: 17,
            maxRuns: 30,
            keywords: ['下一步', '继续'],
            prompt: 'go on'
        })

        expect(loadAutoContinueState('session-1')).toEqual({
            enabled: true,
            remaining: 17,
            maxRuns: 30,
            keywords: ['下一步', '继续'],
            prompt: 'go on'
        })
    })

    it('normalizes invalid keywords back to defaults', () => {
        expect(normalizeAutoContinueKeywords(['', ' 下一步 ', '下一步', 123])).toEqual(['下一步'])
        expect(normalizeAutoContinueKeywords(null)).toEqual(AUTO_CONTINUE_DEFAULT_KEYWORDS)
        expect(normalizeAutoContinuePrompt('  keep going  ')).toBe('keep going')
        expect(normalizeAutoContinuePrompt('   ')).toBe(AUTO_CONTINUE_DEFAULT_PROMPT)
    })

    it('shares keywords and prompt across sessions in the browser', () => {
        saveAutoContinueState('session-1', {
            enabled: true,
            remaining: 5,
            maxRuns: 9,
            keywords: ['shared keyword'],
            prompt: 'shared prompt'
        })

        expect(loadAutoContinueState('session-2')).toEqual({
            enabled: false,
            remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
            maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
            keywords: ['shared keyword'],
            prompt: 'shared prompt'
        })
    })

    it('only scans the latest assistant segment after the last user message', () => {
        const blocks: ChatBlock[] = [
            {
                kind: 'agent-text',
                id: 'old',
                localId: null,
                createdAt: 1,
                text: '下一步先做旧任务'
            },
            {
                kind: 'user-text',
                id: 'user-1',
                localId: null,
                createdAt: 2,
                text: '请继续'
            },
            {
                kind: 'agent-text',
                id: 'new',
                localId: null,
                createdAt: 3,
                text: '先检查测试\n然后总结'
            }
        ]

        expect(getLastAssistantLines(blocks)).toEqual(['先检查测试', '然后总结'])
        expect(shouldAutoContinue(getLastAssistantLines(blocks))).toBe(false)
    })

    it('matches nested tool child lines with trigger text', () => {
        const blocks: ChatBlock[] = [
            {
                kind: 'user-text',
                id: 'user-1',
                localId: null,
                createdAt: 1,
                text: '继续'
            },
            {
                kind: 'tool-call',
                id: 'tool-1',
                localId: null,
                createdAt: 2,
                tool: {
                    id: 'tool-1',
                    name: 'exec',
                    state: 'completed',
                    input: {},
                    createdAt: 2,
                    startedAt: 2,
                    completedAt: 3,
                    description: null
                },
                children: [
                    {
                        kind: 'cli-output',
                        id: 'out-1',
                        localId: null,
                        createdAt: 3,
                        text: '建议的下一步：运行测试',
                        source: 'assistant'
                    }
                ]
            }
        ]

        expect(shouldAutoContinue(getLastAssistantLines(blocks), ['下一步'])).toBe(true)
    })

    it('matches newly added default trigger keywords', () => {
        expect(shouldAutoContinue(['建议下一轮继续验证结果'])).toBe(true)
        expect(shouldAutoContinue(['continue with the cleanup'])).toBe(true)
    })
})
