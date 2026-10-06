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
        expect(summary.items[2]?.completedAt).toBe(6000)
        expect(summary.items[2]?.durationMs).toBe(3000)
        expect(summary.items[3]?.text).toBe('The repository contains a README.')

        const details = service.getTimelineDetails('session-1', 'work-group:3-5')
        expect(details.messages.map((message) => message.seq)).toEqual([3, 4, 5])
        expect(details.group.id).toBe('work-group:3-5')
    })

    it('keeps the folded work duration through the final assistant reply', () => {
        const rows = [
            createMessage(1, { role: 'user', content: 'run the checks' }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'checking files' } } }),
            createMessage(3, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'call-1', name: 'test', input: {} } } }),
            createMessage(20, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'call-1', output: 'passed' } } }),
            createMessage(60, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'All checks passed.' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; limit?: number }) => rows.filter((row) => (
                    (options.startSeq === undefined || row.seq >= options.startSeq)
                    && (options.endSeq === undefined || row.seq <= options.endSeq)
                )).slice(0, options.limit ?? 5000),
                getMaxSeq: () => 60
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const group = service.getTimelineSummary('session-1').items.find((item) => item.kind === 'work-group')

        expect(group).toMatchObject({
            id: 'work-group:2-20',
            startedAt: 2_000,
            completedAt: 60_000,
            durationMs: 58_000
        })
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

    it('keeps Hapi title changes outside folded work groups', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'CodexReasoning', callId: 'call-1', input: {} } } }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'call-1', output: 'done' } } }),
            createMessage(3, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'mcp__hapi__change_title', callId: 'title-1', input: { title: 'A visible title' } } } }),
            createMessage(4, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'title-1', output: { content: 'done' } } } }),
            createMessage(5, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'Finished.' } } })
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
        expect(summary.items.map((item) => item.kind)).toEqual(['work-group', 'event', 'assistant'])
        expect(summary.items[0]?.id).toBe('work-group:1-2')
        expect(summary.items[1]?.text).toBe('Title changed to "A visible title"')
        expect(summary.items[2]?.text).toBe('Finished.')

        const details = service.getTimelineDetails('session-1', 'work-group:1-2')
        expect(details.messages.map((message) => message.seq)).toEqual([1, 2])
    })

    it('marks the assistant title summary so the title emoji is shown on both lines', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'mcp__hapi__change_title', callId: 'title-1', input: { title: 'A visible title' } } } }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'title-1', output: { content: 'done' } } } }),
            createMessage(3, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'A visible title' } } }),
            createMessage(4, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'Finished.' } } })
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
        expect(summary.items.map((item) => item.kind)).toEqual(['event', 'assistant', 'assistant'])
        expect(summary.items[1]).toMatchObject({ text: 'A visible title', titleChange: true })
        expect(summary.items[2]).toMatchObject({ text: 'Finished.' })
        expect(summary.items[2]?.titleChange).toBeUndefined()
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
        expect(summary.items[0]?.lastActivityAt).toBe(1000)
        expect(summary.items[0]?.completedAt).toBeNull()
        expect(summary.items[0]?.durationMs).toBeNull()
    })

    it('marks an unanswered user-input tool in the compact work summary', () => {
        const rows = [
            createMessage(1, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'question-1', name: 'AskUserQuestion', input: { questions: [] } } } }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'question-1', output: 'answered' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; limit?: number }) => rows.filter((row) => (
                    (options.startSeq === undefined || row.seq >= options.startSeq)
                    && (options.endSeq === undefined || row.seq <= options.endSeq)
                )).slice(0, options.limit ?? 5000),
                getMaxSeq: () => rows.at(-1)?.seq ?? 0
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const runningRows = rows.slice(0, 1)
        const runningService = new MessageService({
            messages: {
                getMessagesBySeqRange: () => runningRows,
                getMaxSeq: () => 1
            }
        } as never, {} as never, {} as never)

        expect(runningService.getTimelineSummary('session-1').items[0]?.work?.waitingForInputCount).toBe(1)
        expect(service.getTimelineSummary('session-1').items[0]?.work?.waitingForInputCount).toBe(0)
    })

    it('recognizes an unanswered Claude AskUserQuestion invocation', () => {
        const rows = [createMessage(1, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [{
                            type: 'tool_use',
                            id: 'question-claude-1',
                            name: 'AskUserQuestion',
                            input: { questions: [] }
                        }]
                    }
                }
            }
        })]
        const service = new MessageService({
            messages: {
                getMessagesBySeqRange: () => rows,
                getMaxSeq: () => 1
            }
        } as never, {} as never, {} as never)

        expect(service.getTimelineSummary('session-1').items[0]?.work?.waitingForInputCount).toBe(1)
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

    it('folds automatic continuation messages into the surrounding work group', () => {
        const rows = [
            createMessage(1, { role: 'user', content: 'run the checks', meta: { sentFrom: 'webapp' } }),
            createMessage(2, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', callId: 'call-1', name: 'test', input: {} } } }),
            createMessage(3, { role: 'user', content: 'continue', meta: { sentFrom: 'auto-continue' } }),
            createMessage(4, { role: 'agent', content: { type: 'codex', data: { type: 'tool-call-result', callId: 'call-1', output: 'passed' } } }),
            createMessage(5, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'All checks passed.' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; limit?: number }) => rows.filter((row) => (
                    (options.startSeq === undefined || row.seq >= options.startSeq)
                    && (options.endSeq === undefined || row.seq <= options.endSeq)
                )),
                getMaxSeq: () => rows.at(-1)?.seq ?? 0,
                getMessageEpoch: () => 0,
                getUserTurnMessages: () => rows.filter((row) => row.content && typeof row.content === 'object' && (row.content as { role?: string }).role === 'user')
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const summary = service.getTimelineSummary('session-1')
        expect(summary.items.map((item) => item.kind)).toEqual(['user', 'work-group', 'assistant'])
        expect(summary.items[1]).toMatchObject({ id: 'work-group:2-4', seqStart: 2, seqEnd: 4 })
        expect(summary.items[1]?.work?.toolCount).toBe(1)
        expect(service.getConversationOutline('session-1').map((item) => item.text)).toEqual(['run the checks'])
    })

    it('supports around-seq loading from the cached compact projection', () => {
        const rows = [
            createMessage(1, { role: 'user', content: 'first' }),
            createMessage(2, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'first answer' } } }),
            createMessage(3, { role: 'user', content: 'second' }),
            createMessage(4, { role: 'agent', content: { type: 'output', data: { type: 'summary', summary: 'second answer' } } })
        ]
        const fakeStore = {
            messages: {
                getMessagesBySeqRange: (_sessionId: string, options: { startSeq?: number; endSeq?: number; limit?: number }) => rows.filter((row) => (
                    (options.startSeq === undefined || row.seq >= options.startSeq)
                    && (options.endSeq === undefined || row.seq <= options.endSeq)
                )),
                getMaxSeq: () => rows.at(-1)?.seq ?? 0,
                getMessageEpoch: () => 0
            }
        }
        const service = new MessageService(fakeStore as never, {} as never, {} as never)

        const summary = service.getTimelineSummary('session-1', { limit: 1, aroundSeq: 3 })
        expect(summary.items).toHaveLength(1)
        expect(summary.items[0]).toMatchObject({ kind: 'user', text: 'second', seqStart: 3 })
        expect(summary.page.epoch).toBe(0)
    })
})
