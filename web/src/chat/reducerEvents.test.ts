import { describe, expect, it } from 'vitest'
import { foldAutoRetryRecoveries, parseMessageAsEvent } from './reducerEvents'
import type { AgentEventBlock, ChatBlock, NormalizedMessage, UserTextBlock } from './types'

function makeAgentTextMessage(text: string): NormalizedMessage {
    return {
        role: 'agent',
        content: [{ type: 'text', text, uuid: 'u1', parentUUID: null }],
        id: 'msg-1',
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
    }
}

describe('parseMessageAsEvent — usage limit formats', () => {
    it('parses reached with limitType', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000|five_hour')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: 'five_hour',
        })
    })

    it('parses reached without limitType (backward compat)', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: '',
        })
    })

    it('parses warning with five_hour type', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774278000|90|five_hour')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 0.9,
            endsAt: 1774278000,
            limitType: 'five_hour',
        })
    })

    it('parses warning with seven_day type', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774850400|85|seven_day')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 0.85,
            endsAt: 1774850400,
            limitType: 'seven_day',
        })
    })

    it('handles missing limitType', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774278000|100|')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 1,
            endsAt: 1774278000,
            limitType: '',
        })
    })

    it('returns null for non-limit text', () => {
        const msg = makeAgentTextMessage('Hello world')
        expect(parseMessageAsEvent(msg)).toBeNull()
    })

    it('returns null for sidechain messages', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000')
        msg.isSidechain = true
        expect(parseMessageAsEvent(msg)).toBeNull()
    })
})

function makeEventBlock(id: string, message: string): AgentEventBlock {
    return {
        kind: 'agent-event',
        id,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        event: { type: 'message', message }
    }
}

function makeUserBlock(id: string, sentFrom: string): UserTextBlock {
    return {
        kind: 'user-text',
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        text: 'continue',
        meta: { sentFrom }
    }
}

describe('foldAutoRetryRecoveries', () => {
    it('folds repeated failure and automatic continue groups into one summary', () => {
        const success: ChatBlock = {
            kind: 'agent-text',
            id: 'success',
            localId: null,
            createdAt: 10,
            text: 'Done'
        }
        const blocks = foldAutoRetryRecoveries([
            makeEventBlock('e1', 'Task failed: Our servers are currently overloaded; retrying same conversation (1/3)'),
            makeEventBlock('e2', 'Task failed: Our servers are currently overloaded'),
            makeUserBlock('u1', 'auto-retry'),
            makeEventBlock('e3', 'Task failed: Selected model is at capacity'),
            makeUserBlock('u2', 'auto-retry'),
            success
        ])

        expect(blocks).toHaveLength(2)
        expect(blocks[0]).toMatchObject({
            kind: 'agent-event',
            event: {
                type: 'auto-retry-summary',
                recoveryCount: 2,
                retryCount: 3,
                details: [
                    'AUTO retry 1/3',
                    'AUTO retry failed',
                    'continue',
                    'AUTO retry failed',
                    'continue'
                ]
            }
        })
        expect(blocks[1]).toBe(success)
    })

    it('folds built-in retry markers without calling them AUTO recovery', () => {
        const blocks = foldAutoRetryRecoveries([
            makeEventBlock('e1', 'Task failed: Our servers are currently overloaded; retrying same conversation (1/3)'),
            makeEventBlock('e2', 'Task failed: Our servers are currently overloaded; retrying same conversation (2/3)')
        ])

        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({
            kind: 'agent-event',
            event: {
                type: 'auto-retry-summary',
                recoveryCount: 0,
                retryCount: 2
            }
        })
    })

    it('does not hide a manual continue or fold an isolated failure', () => {
        const failure = makeEventBlock('e1', 'Task failed: Selected model is at capacity')
        const manualContinue = makeUserBlock('u1', 'webapp')
        const blocks = foldAutoRetryRecoveries([failure, manualContinue])

        expect(blocks).toEqual([failure, manualContinue])
    })

    it('keeps a mode switch inside the same AUTO recovery summary', () => {
        const blocks = foldAutoRetryRecoveries([
            makeEventBlock('e1', 'Task failed: Selected model is at capacity'),
            {
                kind: 'agent-event',
                id: 'switch-1',
                createdAt: 2,
                event: { type: 'switch', mode: 'remote' }
            },
            makeUserBlock('u1', 'auto-retry'),
            makeEventBlock('e2', 'Task failed: Selected model is at capacity')
        ])

        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({
            kind: 'agent-event',
            event: {
                type: 'auto-retry-summary',
                recoveryCount: 2,
                details: ['AUTO retry failed', 'continue', 'AUTO retry failed']
            }
        })
    })

    it('folds generic Codex failures and a following continue into one AUTO row', () => {
        const blocks = foldAutoRetryRecoveries([
            makeEventBlock('e1', 'Task failed: Codex thread entered systemError'),
            makeEventBlock('e2', 'Task failed: Selected model is at capacity'),
            makeEventBlock('e3', 'Task failed'),
            makeUserBlock('u1', 'webapp')
        ])

        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({
            kind: 'agent-event',
            event: {
                type: 'auto-retry-summary',
                recoveryCount: 1,
                details: [
                    'AUTO retry failed',
                    'AUTO retry failed',
                    'AUTO retry failed',
                    'continue'
                ]
            }
        })
    })
})
