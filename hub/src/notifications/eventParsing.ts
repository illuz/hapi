import { AGENT_MESSAGE_PAYLOAD_TYPE, isObject } from '@hapi/protocol'
import type { SyncEvent } from '../sync/syncEngine'

type EventEnvelope = {
    type?: unknown
    data?: unknown
}

function extractEventEnvelope(message: unknown): EventEnvelope | null {
    if (!isObject(message)) {
        return null
    }

    if (message.type === 'event') {
        return message as EventEnvelope
    }

    const content = message.content
    if (!isObject(content) || content.type !== 'event') {
        return null
    }

    return content as EventEnvelope
}

export function extractMessageEventType(event: SyncEvent): string | null {
    if (event.type !== 'message-received') {
        return null
    }

    const message = event.message?.content
    const envelope = extractEventEnvelope(message)
    if (!envelope) {
        return null
    }

    const data = isObject(envelope.data) ? envelope.data : null
    const eventType = data?.type
    return typeof eventType === 'string' ? eventType : null
}

function extractEventEnvelopeData(event: SyncEvent): Record<string, unknown> | null {
    if (event.type !== 'message-received') {
        return null
    }

    const message = event.message?.content
    const envelope = extractEventEnvelope(message)
    if (!envelope) {
        return null
    }

    return isObject(envelope.data) ? envelope.data : null
}

function extractAgentPayloadData(event: SyncEvent): Record<string, unknown> | null {
    if (event.type !== 'message-received') {
        return null
    }

    const message = event.message?.content
    if (!isObject(message) || message.role !== 'agent') {
        return null
    }

    const content = message.content
    if (!isObject(content) || content.type !== AGENT_MESSAGE_PAYLOAD_TYPE) {
        return null
    }

    return isObject(content.data) ? content.data : null
}

export function isFailureEventMessage(event: SyncEvent): string | null {
    const data = extractEventEnvelopeData(event)
    if (!data || data.type !== 'message' || typeof data.message !== 'string') {
        return null
    }

    const message = data.message.trim()
    if (!message) {
        return null
    }

    const normalized = message.toLowerCase()
    if (
        normalized.includes('failed')
        || normalized.includes('error')
        || normalized.includes('aborted')
        || normalized.includes('unexpectedly')
    ) {
        return message
    }

    return null
}

export function isAgentTextMessage(event: SyncEvent): boolean {
    const data = extractAgentPayloadData(event)
    return !!data && data.type === 'message' && typeof data.message === 'string' && data.message.trim().length > 0
}
