import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'

import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function createPublisher(): EventPublisher {
    return {
        emit: (_event: SyncEvent) => {}
    } as EventPublisher
}

function addHistoryEntry(store: Store, sessionId: string, assistantMessageId: string): void {
    store.history.addEntry({
        namespace: 'default',
        sessionId,
        userMessageId: `user-${assistantMessageId}`,
        assistantMessageId,
        title: 'History merge',
        userText: `User ${assistantMessageId}`,
        assistantExcerpt: `Assistant ${assistantMessageId}`
    })
}

describe('session history merge', () => {
    it('moves history entries before deleting the source session and removes duplicate assistant entries', async () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher())
        const source = cache.getOrCreateSession(
            'history-source',
            { path: '/tmp/history-source', flavor: 'codex' },
            null,
            'default'
        )
        const target = cache.getOrCreateSession(
            'history-target',
            { path: '/tmp/history-target', flavor: 'codex' },
            null,
            'default'
        )

        addHistoryEntry(store, source.id, 'source-only')
        addHistoryEntry(store, source.id, 'shared')
        addHistoryEntry(store, target.id, 'shared')

        await cache.mergeSessions(source.id, target.id, 'default')

        const history = store.history.search({
            namespace: 'default',
            scope: 'session',
            sessionId: target.id,
            limit: 50
        })
        expect(history.entries.map((entry) => entry.assistantMessageId).sort()).toEqual([
            'shared',
            'source-only'
        ])
        expect(store.history.search({
            namespace: 'default',
            scope: 'all',
            limit: 50
        }).entries).toHaveLength(2)
    })
})
