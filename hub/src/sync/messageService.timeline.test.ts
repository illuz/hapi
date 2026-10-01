import { describe, expect, it } from 'bun:test'
import { MessageService } from './messageService'
import type { StoredMessage } from '../store'

function createMessage(seq: number, content: unknown): StoredMessage {
    return {
        id: `message-${seq}`,
        sessionId: 'session-1',
        content,
        createdAt: seq * 1000,
        seq,
        localId: null,
        invokedAt: seq * 1000
    }
}

describe('MessageService timeline', () => {
    it('groups execution messages while keeping user and answer text visible', () => {
        const rows = [
            createMessage(1, { role: 'user', content: 'inspect the repository' }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'I will inspect it.' } } }),
            createMessage(3, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'checking files' } } }),
            createMessage(4, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', id: 'event-call-1', callId: 'call-1', name: 'rg', input: {} } } }),
            createMessage(5, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', id: 'event-result-1', callId: 'call-1', output: 'README.md' } } }),
            createMessage(6, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'The repository contains a README.' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; beforeSeq?: number; limit?: number }) => {
                    let result = rows.filter((row) => (
                        (options.startSeq === undefined || row.seq >= options.startSeq)
                        && (options.endSeq === undefined || row.seq <= options.endSeq)
                        && (options.beforeSeq === undefined || row.seq < options.beforeSeq)
                    ))
                    if (options.startSeq === undefined && options.endSeq === undefined) {
                        result = result.slice(-Math.min(options.limit ?? 5000, result.length))
                    } else {
                        result = result.slice(0, options.limit ?? 5000)
                    }
                    return result
                }
            }
        }
        const service = new MessageService(
            fakeStore as never,
            {} as never,
            {} as never
        )

        const summary = service.getTimelineSummary('session-1')
        expect(summary.items.map((item) => item.kind)).toEqual(['user', 'assistant', 'work-group', 'assistant'])
        expect(summary.items[0]?.text).toBe('inspect the repository')
        expect(summary.items[1]?.text).toBe('I will inspect it.')
        expect(summary.items[2]?.id).toBe('work-group:3-5')
        expect(summary.items[2]?.work?.toolGroupCount).toBe(1)
        expect(summary.items[2]?.work?.toolCount).toBe(1)
        expect(summary.items[2]?.work?.runningCount).toBe(0)
        expect(summary.items[2]?.completedAt).toBe(5000)
        expect(summary.items[3]?.text).toBe('The repository contains a README.')

        const details = service.getTimelineDetails('session-1', 'work-group:3-5')
        expect(details.messages.map((message) => message.seq)).toEqual([3, 4, 5])
        expect(details.group.id).toBe('work-group:3-5')
    })

    it('rejects malformed work-group ranges', () => {
        const service = new MessageService({ messages: { getMessagesBySeqRange: () => [] } } as never, {} as never, {} as never)
        expect(() => service.getTimelineDetails('session-1', 'work-group:8-2')).toThrow('Invalid timeline group range')
        expect(() => service.getTimelineDetails('session-1', 'not-a-group')).toThrow('Invalid timeline group')
    })

    it('keeps commentary visible when one assistant payload also starts work', () => {
        const rows = [
            createMessage(1, { role: 'user', content: 'inspect the repository' }),
            createMessage(2, {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'text', text: 'I will inspect the files first.' },
                                { type: 'thinking', thinking: 'Looking for the relevant source.' },
                                { type: 'tool_use', id: 'call-1', name: 'rg', input: {} }
                            ]
                        }
                    }
                }
            })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; beforeSeq?: number; limit?: number }) => {
                    const result = rows.filter((row) => (
                        (options.startSeq === undefined || row.seq >= options.startSeq)
                        && (options.endSeq === undefined || row.seq <= options.endSeq)
                        && (options.beforeSeq === undefined || row.seq < options.beforeSeq)
                    ))
                    return options.startSeq === undefined && options.endSeq === undefined
                        ? result.slice(-Math.min(options.limit ?? 5000, result.length))
                        : result.slice(0, options.limit ?? 5000)
                }
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const summary = service.getTimelineSummary('session-1')
        expect(summary.items.map((item) => item.kind)).toEqual(['user', 'assistant', 'work-group'])
        expect(summary.items[1]?.text).toBe('I will inspect the files first.')
        expect(summary.items[2]?.id).toBe('work-group:2-2')
    })

    it('folds visible events with execution and ignores ready/token snapshots', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'first' } } }),
            createMessage(2, { role: 'agent', content: { type: 'event', data: { type: 'switch', mode: 'remote' } } }),
            createMessage(3, { role: 'agent', content: { type: 'codex', data: { type: 'token_count', info: { last: { inputTokens: 1, outputTokens: 1 } } } } }),
            createMessage(4, { role: 'agent', content: { type: 'event', data: { type: 'ready' } } }),
            createMessage(5, { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'init' } } }),
            createMessage(6, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'second' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; beforeSeq?: number; limit?: number }) => {
                    const result = rows.filter((row) => (
                        (options.startSeq === undefined || row.seq >= options.startSeq)
                        && (options.endSeq === undefined || row.seq <= options.endSeq)
                        && (options.beforeSeq === undefined || row.seq < options.beforeSeq)
                    ))
                    return options.startSeq === undefined && options.endSeq === undefined
                        ? result.slice(-Math.min(options.limit ?? 5000, result.length))
                        : result.slice(0, options.limit ?? 5000)
                }
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const summary = service.getTimelineSummary('session-1')
        expect(summary.items).toHaveLength(1)
        expect(summary.items[0]?.id).toBe('work-group:1-6')
        expect(summary.items[0]?.work?.reasoningCount).toBe(2)
        expect(summary.items[0]?.work?.eventCount).toBe(1)
    })

    it('marks a work group running until its tool result arrives', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'call-1', name: 'rg', input: {} } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: () => rows
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const summary = service.getTimelineSummary('session-1')
        expect(summary.items[0]?.work?.runningCount).toBe(1)
        expect(summary.items[0]?.completedAt).toBeNull()
        expect(summary.items[0]?.durationMs).toBeNull()
    })

    it('folds task notifications without exposing the raw XML payload', () => {
        const rows = [
            createMessage(1, {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'user',
                        isSidechain: true,
                        message: {
                            content: '<task-notification><summary>Background command stopped</summary></task-notification>'
                        }
                    }
                }
            })
        ]
        const service = new MessageService({ messages: { getMessagesBySeqRange: () => rows } } as never, {} as never, {} as never)
        const summary = service.getTimelineSummary('session-1')

        expect(summary.items).toHaveLength(1)
        expect(summary.items[0]?.kind).toBe('work-group')
        expect(summary.items[0]?.text).toBeUndefined()
        expect(summary.items[0]?.work?.eventCount).toBe(1)
    })

    it('does not split work on empty payloads or duplicate Codex snapshots', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', id: 'stream-1', message: 'old' } } }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'unknown' } } }),
            createMessage(3, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', id: 'stream-1', message: 'latest' } } }),
            createMessage(4, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'call-1', name: 'rg', input: {} } } })
        ]
        const service = new MessageService({ messages: { getMessagesBySeqRange: () => rows } } as never, {} as never, {} as never)
        const summary = service.getTimelineSummary('session-1')

        expect(summary.items).toHaveLength(1)
        expect(summary.items[0]?.id).toBe('work-group:3-4')
        expect(summary.items[0]?.work?.reasoningCount).toBe(1)
    })
})
