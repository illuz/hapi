import { describe, expect, it } from 'vitest'
import {
    AUTO_CONTINUE_DEFAULT_KEYWORDS,
    AUTO_CONTINUE_DEFAULT_MESSAGE,
    AUTO_CONTINUE_DEFAULT_REMAINING,
    getLastAssistantLinesFromMessages,
    normalizeAutoContinueMessageText,
    normalizeAutoContinueSettings,
    normalizeAutoContinueKeywords,
    shouldAutoContinue
} from './autoContinue'

describe('autoContinue', () => {
    it('normalizes defaults', () => {
        expect(normalizeAutoContinueSettings(null)).toEqual({
            enabled: false,
            remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
            maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
            keywords: AUTO_CONTINUE_DEFAULT_KEYWORDS,
            messageText: AUTO_CONTINUE_DEFAULT_MESSAGE
        })
    })

    it('normalizes invalid keywords back to defaults', () => {
        expect(normalizeAutoContinueKeywords(['', ' 下一步 ', '下一步', 123])).toEqual(['下一步'])
        expect(normalizeAutoContinueKeywords(null)).toEqual(AUTO_CONTINUE_DEFAULT_KEYWORDS)
        expect(normalizeAutoContinueMessageText('   ')).toBe(AUTO_CONTINUE_DEFAULT_MESSAGE)
    })

    it('only scans the latest assistant segment after the last user message', () => {
        const messages = [
            {
                content: {
                    role: 'agent',
                    content: { type: 'output', data: { type: 'assistant', message: { content: '下一步先做旧任务' } } }
                }
            },
            {
                content: {
                    role: 'user',
                    content: { type: 'text', text: '请继续' }
                }
            },
            {
                content: {
                    role: 'agent',
                    content: { type: 'output', data: { type: 'assistant', message: { content: '先检查测试\n然后总结' } } }
                }
            }
        ]

        expect(getLastAssistantLinesFromMessages(messages)).toEqual(['先检查测试', '然后总结'])
        expect(shouldAutoContinue(getLastAssistantLinesFromMessages(messages))).toBe(false)
    })

    it('matches nested tool result lines with trigger text', () => {
        const messages = [
            {
                content: {
                    role: 'user',
                    content: { type: 'text', text: '继续' }
                }
            },
            {
                content: {
                    role: 'agent',
                    content: {
                        type: 'output',
                        data: {
                            type: 'user',
                            message: {
                                content: [
                                    {
                                        type: 'tool_result',
                                        tool_use_id: 'tool-1',
                                        content: '建议的下一步：运行测试'
                                    }
                                ]
                            }
                        }
                    }
                },
            }
        ]

        expect(shouldAutoContinue(getLastAssistantLinesFromMessages(messages), ['下一步'])).toBe(true)
    })
})
