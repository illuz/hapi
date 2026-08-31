import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'
import { SessionCache } from '../sync/sessionCache'
import type { EventPublisher } from '../sync/eventPublisher'

function dbOf(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

describe('SessionStore pinned state', () => {
    it('defaults to unpinned and persists pin changes within a namespace', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'pin-test',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )

        expect(session.pinned).toBe(false)
        expect(store.sessions.setSessionPinned(session.id, true, 'default')).toBe(true)
        expect(store.sessions.getSession(session.id)?.pinned).toBe(true)
        expect(store.sessions.setSessionPinned(session.id, false, 'default')).toBe(true)
        expect(store.sessions.getSession(session.id)?.pinned).toBe(false)
    })

    it('does not update a session from another namespace', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'pin-namespace-test',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'alpha'
        )

        expect(store.sessions.setSessionPinned(session.id, true, 'beta')).toBe(false)
        expect(store.sessions.getSession(session.id)?.pinned).toBe(false)
    })

    it('keeps cache versions stable when setting the current pin state', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'pin-idempotent-test',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        const events: unknown[] = []
        const publisher = {
            emit: (event: unknown) => events.push(event)
        } as unknown as EventPublisher
        const cache = new SessionCache(store, publisher)
        cache.refreshSession(session.id)

        await cache.setSessionPinned(session.id, true)
        const firstSeq = cache.getSession(session.id)?.seq
        const firstEventCount = events.length

        await cache.setSessionPinned(session.id, true)

        expect(cache.getSession(session.id)?.seq).toBe(firstSeq)
        expect(store.sessions.getSession(session.id)?.seq).toBe(firstSeq)
        expect(events).toHaveLength(firstEventCount)
    })

    it('migrates legacy starred sessions to pinned state', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-session-pin-migration-'))
        const dbPath = join(dir, 'test.db')

        try {
            const existing = new Store(dbPath)
            const session = existing.sessions.getOrCreateSession(
                'pin-migration-test',
                { path: '/tmp/project', host: 'localhost' },
                null,
                'default'
            )
            const db = dbOf(existing)
            db.exec('ALTER TABLE sessions ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
            db.prepare('UPDATE sessions SET starred = 1 WHERE id = ?').run(session.id)
            db.exec('ALTER TABLE sessions DROP COLUMN pinned')
            db.exec('PRAGMA user_version = 16')
            db.close()

            const migrated = new Store(dbPath)
            expect(migrated.sessions.getSession(session.id)?.pinned).toBe(true)
            const columns = dbOf(migrated)
                .prepare('PRAGMA table_info(sessions)')
                .all()
                .map((row) => (row as { name: string }).name)
            expect(columns).toContain('pinned')
            expect(migrated.sessions.setSessionPinned(session.id, false, 'default')).toBe(true)
            dbOf(migrated).close()

            const reopened = new Store(dbPath)
            expect(reopened.sessions.getSession(session.id)?.pinned).toBe(false)
            dbOf(reopened).close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
