import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'

import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { ConversationHistoryService } from './conversationHistoryService'
import { SessionCache } from './sessionCache'

function createPublisher(): EventPublisher {
    return {
        emit: (_event: SyncEvent) => {}
    } as EventPublisher
}

function createService() {
    const store = new Store(':memory:')
    const cache = new SessionCache(store, createPublisher())
    const service = new ConversationHistoryService(store, (sessionId) => cache.getSession(sessionId))
    return { store, cache, service }
}

function addUserMessage(store: Store, sessionId: string, text: string): void {
    store.messages.addMessage(sessionId, {
        role: 'user',
        content: { type: 'text', text }
    })
}

function addAgentMessage(store: Store, sessionId: string, text: string): void {
    store.messages.addMessage(sessionId, {
        role: 'agent',
        content: { type: 'text', text }
    })
}

function searchSessionHistory(store: Store, sessionId: string) {
    return store.history.search({
        namespace: 'default',
        scope: 'session',
        sessionId,
        limit: 50
    })
}

describe('ConversationHistoryService', () => {
    it('records a completed turn when its user message is more than one page behind', () => {
        const { store, cache, service } = createService()
        const session = cache.getOrCreateSession(
            'long-completion',
            { path: '/tmp/long-completion', flavor: 'codex' },
            null,
            'default'
        )

        addUserMessage(store, session.id, 'Summarize the migration')
        for (let index = 0; index < 250; index += 1) {
            addAgentMessage(store, session.id, index === 249 ? 'Migration summary' : '')
        }

        service.recordCompletion(session.id)

        const history = searchSessionHistory(store, session.id)
        expect(history.entries).toHaveLength(1)
        expect(history.entries[0]?.userText).toBe('Summarize the migration')
        expect(history.entries[0]?.assistantExcerpt).toBe('Migration summary')
    })

    it('backfills every completed turn across message pages only once', () => {
        const { store, cache, service } = createService()
        const session = cache.getOrCreateSession(
            'paged-backfill',
            { path: '/tmp/paged-backfill', flavor: 'codex' },
            null,
            'default'
        )

        for (let turn = 1; turn <= 3; turn += 1) {
            addUserMessage(store, session.id, `User turn ${turn}`)
            for (let index = 0; index < 210; index += 1) {
                addAgentMessage(store, session.id, index === 209 ? `Assistant turn ${turn}` : '')
            }
        }

        expect(service.backfillSession(session.id)).toEqual({ entriesAttempted: 3 })
        expect(searchSessionHistory(store, session.id).entries.map((entry) => entry.userText)).toEqual([
            'User turn 3',
            'User turn 2',
            'User turn 1'
        ])
        expect(service.backfillSession(session.id)).toEqual({ entriesAttempted: 0 })
    })
})
