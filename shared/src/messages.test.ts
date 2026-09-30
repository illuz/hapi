import { describe, expect, it } from 'bun:test'
import { AGENT_MESSAGE_PAYLOAD_TYPE } from './modes'
import { getLiveReasoningStreamId, getReasoningStreamId } from './messages'

function makeReasoningMessage(overrides: Record<string, unknown> = {}) {
    return {
        role: 'agent',
        content: {
            type: AGENT_MESSAGE_PAYLOAD_TYPE,
            data: {
                type: 'reasoning',
                message: 'thinking',
                id: 'stream-1',
                ...overrides
            }
        }
    }
}

describe('reasoning stream identity', () => {
    it('reads the stream id from live snapshots', () => {
        const message = makeReasoningMessage({ live: true })

        expect(getReasoningStreamId(message)).toBe('stream-1')
        expect(getLiveReasoningStreamId(message)).toBe('stream-1')
    })

    it('keeps the stream id after the reasoning settles but no longer marks it live', () => {
        const message = makeReasoningMessage()

        expect(getReasoningStreamId(message)).toBe('stream-1')
        expect(getLiveReasoningStreamId(message)).toBeNull()
    })

    it('ignores unrelated or malformed payloads', () => {
        expect(getReasoningStreamId({ role: 'user', content: {} })).toBeNull()
        expect(getReasoningStreamId(makeReasoningMessage({ id: '' }))).toBeNull()
        expect(getReasoningStreamId({ role: 'agent', content: { type: 'text', text: 'answer' } })).toBeNull()
    })
})
