import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

function dbOf(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

function tableNames(store: Store): string[] {
    return dbOf(store)
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name)
}

describe('PortMappingsStore', () => {
    it('fresh schema creates the port_mappings table and indexes', () => {
        const store = new Store(':memory:')

        expect(tableNames(store)).toContain('port_mappings')
        const indexes = dbOf(store)
            .prepare("PRAGMA index_list(port_mappings)")
            .all()
            .map((row) => (row as { name: string }).name)

        expect(indexes).toContain('idx_port_mappings_namespace_project')
        expect(indexes).toContain('idx_port_mappings_alias')
        expect(indexes).toContain('idx_port_mappings_expiry')
    })

    it('migrates a v14 database to add port mappings', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-port-mapping-migration-'))
        const dbPath = join(dir, 'test.db')
        try {
            const existing = new Store(dbPath)
            dbOf(existing).exec('DROP TABLE port_mappings; PRAGMA user_version = 14;')
            dbOf(existing).close()

            const migrated = new Store(dbPath)
            expect(tableNames(migrated)).toContain('port_mappings')
            const version = dbOf(migrated).prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(15)
            dbOf(migrated).close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('creates, lists, updates, disables, enables, and expires mappings', () => {
        const store = new Store(':memory:')

        const created = store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            port: 8080,
            durationMs: 30 * 60_000,
            accessTokenHash: 'hash-1',
            now: 1_000
        })

        expect(created).toMatchObject({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            port: 8080,
            targetHost: '127.0.0.1',
            enabled: true,
            expiresAt: 1_801_000,
            lastEnabledAt: 1_000
        })

        expect(store.portMappings.list({ namespace: 'default', machineId: 'machine-1', projectPath: '/repo' }).map((item) => item.id))
            .toEqual([created.id])

        const updated = store.portMappings.update('default', created.id, {
            alias: 'repo_3000',
            port: 3000,
            durationMs: 10 * 60_000
        }, 2_000)
        expect(updated).toMatchObject({
            alias: 'repo_3000',
            port: 3000,
            durationMs: 10 * 60_000,
            enabled: true,
            updatedAt: 2_000
        })

        const disabled = store.portMappings.disable('default', created.id, 3_000)
        expect(disabled).toMatchObject({ enabled: false, updatedAt: 3_000 })

        const enabled = store.portMappings.enable('default', created.id, {
            durationMs: 60_000,
            accessTokenHash: 'hash-2'
        }, 4_000)
        expect(enabled).toMatchObject({
            enabled: true,
            durationMs: 60_000,
            expiresAt: 64_000,
            lastEnabledAt: 4_000,
            accessTokenHash: 'hash-2'
        })

        const expired = store.portMappings.expire(64_000)
        expect(expired.map((item) => item.id)).toEqual([created.id])
        expect(store.portMappings.get('default', created.id)).toMatchObject({
            enabled: false,
            updatedAt: 64_000
        })
    })

    it('keeps aliases unique per namespace', () => {
        const store = new Store(':memory:')
        store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            port: 8080,
            durationMs: 60_000,
            accessTokenHash: 'hash-1',
            now: 1_000
        })

        expect(() => store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/other',
            alias: 'repo_8080',
            port: 8080,
            durationMs: 60_000,
            accessTokenHash: 'hash-2',
            now: 1_000
        })).toThrow()

        expect(store.portMappings.create({
            namespace: 'other',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            port: 8080,
            durationMs: 60_000,
            accessTokenHash: 'hash-3',
            now: 1_000
        })).toMatchObject({ namespace: 'other', alias: 'repo_8080' })
    })
})
