import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('Store V19→V20 migration: message_epochs', () => {
    it('fresh DB has message_epochs table', () => {
        const store = new Store(':memory:')
        const db = dbOf(store)
        expect(tableExists(db, 'message_epochs')).toBe(true)
        expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 20 })
        db.close()
    })

    it('V19 DB migrates and preserves existing messages', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v20-test-'))
        const dbPath = join(dir, 'test.db')
        try {
            const initial = new Store(dbPath)
            const db = dbOf(initial)
            db.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)').run('session-1', 1, 1)
            db.prepare(`
                INSERT INTO messages (id, session_id, content, created_at, seq, invoked_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('message-1', 'session-1', '{}', 1, 1, 1)
            db.exec('DROP TABLE message_epochs; PRAGMA user_version = 19;')
            db.close()

            const migrated = new Store(dbPath)
            const migratedDb = dbOf(migrated)
            expect(tableExists(migratedDb, 'message_epochs')).toBe(true)
            expect(migrated.messages.getMessageEpoch('session-1')).toBe(0)
            expect(migrated.messages.getMessages('session-1')).toHaveLength(1)
            migratedDb.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function dbOf(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

function tableExists(db: Database, name: string): boolean {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name) as { name: string } | null
    return row !== null
}
