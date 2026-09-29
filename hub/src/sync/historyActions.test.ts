import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

function createHarness() {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const engine = new SyncEngine(
        store,
        {
            of: () => ({
                sockets: new Map(),
                to: () => ({ emit() {} }),
                emit() {}
            })
        } as never,
        new RpcRegistry(),
        { broadcast: (event: SyncEvent) => events.push(event) } as never
    )
    const session = engine.getOrCreateSession(
        'history-actions',
        { path: '/tmp/history-actions', host: 'localhost', flavor: 'codex' },
        null,
        'default'
    )
    engine.handleSessionAlive({
        sid: session.id,
        time: Date.now(),
        thinking: false,
        mode: 'remote'
    })

    return { engine, store, session, events }
}

function addInvokedUser(store: Store, sessionId: string, localId: string, text: string) {
    const message = store.messages.addMessage(sessionId, {
        role: 'user',
        content: { type: 'text', text }
    }, localId)
    store.messages.markMessagesInvoked(sessionId, [localId], Date.now())
    return message
}

describe('SyncEngine history actions', () => {
    it('keeps steer invocation state owned by the CLI acknowledgement event', async () => {
        const { engine, store, session, events } = createHarness()
        try {
            const message = store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'queued' }
            }, 'queued-local')
            ;(engine as any).rpcGateway.steerQueuedMessage = async () => ({ steered: true })

            await expect(engine.steerQueuedMessage(session.id, message.id)).resolves.toEqual({
                status: 'steered',
                localId: 'queued-local'
            })
            expect(store.messages.getMessageByIdOrLocalId(session.id, 'queued-local')?.invokedAt).toBeNull()
            expect(events.some((event) => event.type === 'messages-consumed')).toBe(false)
        } finally {
            engine.stop()
        }
    })

    it('rewinds native history before truncating the Hub transcript and emits invalidation', async () => {
        const { engine, store, session, events } = createHarness()
        try {
            const first = addInvokedUser(store, session.id, 'local-first', 'first')
            const second = addInvokedUser(store, session.id, 'local-second', 'second')
            const answer = store.messages.addMessage(session.id, {
                role: 'agent',
                content: { type: 'text', text: 'answer' }
            })
            store.history.addEntry({
                namespace: 'default',
                sessionId: session.id,
                userMessageId: second.id,
                assistantMessageId: answer.id,
                title: 'history',
                userText: 'second',
                assistantExcerpt: 'answer'
            })

            const rpcBoundary: { value: string | null } = { value: null }
            ;(engine as any).rpcGateway.rewindConversation = async (
                _sessionId: string,
                params: { messageLocalId: string }
            ) => {
                rpcBoundary.value = params.messageLocalId
                return { success: true }
            }

            await expect(engine.rewindConversation(session.id, 'default', second.id)).resolves.toEqual({ type: 'success' })
            expect(rpcBoundary.value).toBe('local-second')
            expect(store.messages.getMessages(session.id).map((message) => message.id)).toEqual([first.id])
            expect(store.history.search({
                namespace: 'default',
                scope: 'session',
                sessionId: session.id
            }).entries).toHaveLength(0)
            expect(events).toContainEqual({
                type: 'messages-invalidated',
                sessionId: session.id,
                namespace: 'default',
                reason: 'rewind',
                truncateFromLocalId: 'local-second'
            })
        } finally {
            engine.stop()
        }
    })

    it('rejects a queued history boundary without invoking native RPC', async () => {
        const { engine, store, session } = createHarness()
        try {
            const queued = store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'not ready' }
            }, 'queued-boundary')
            let called = false
            ;(engine as any).rpcGateway.rewindConversation = async () => {
                called = true
                return { success: true }
            }

            await expect(engine.rewindConversation(session.id, 'default', queued.id)).resolves.toEqual({
                type: 'error',
                message: 'Session has queued messages'
            })
            expect(called).toBe(false)
        } finally {
            engine.stop()
        }
    })
})
