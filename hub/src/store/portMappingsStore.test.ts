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

    it('migrates a v15 database to add static mapping columns', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-port-mapping-migration-'))
        const dbPath = join(dir, 'test.db')
        try {
            const existing = new Store(dbPath)
            dbOf(existing).exec(`
                CREATE TABLE port_mappings_v15 (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL,
                    machine_id TEXT NOT NULL,
                    project_path TEXT NOT NULL,
                    alias TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    target_host TEXT NOT NULL DEFAULT '127.0.0.1',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    duration_ms INTEGER NOT NULL,
                    expires_at INTEGER,
                    last_enabled_at INTEGER,
                    access_token_hash TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(namespace, alias)
                );
                INSERT INTO port_mappings_v15 (
                    id, namespace, machine_id, project_path, alias, port, target_host,
                    enabled, duration_ms, expires_at, last_enabled_at, access_token_hash,
                    created_at, updated_at
                )
                SELECT
                    id, namespace, machine_id, project_path, alias, port, target_host,
                    enabled, duration_ms, expires_at, last_enabled_at, access_token_hash,
                    created_at, updated_at
                FROM port_mappings;
                DROP TABLE port_mappings;
                ALTER TABLE port_mappings_v15 RENAME TO port_mappings;
                CREATE INDEX idx_port_mappings_namespace_project
                    ON port_mappings(namespace, machine_id, project_path);
                CREATE INDEX idx_port_mappings_alias
                    ON port_mappings(alias);
                CREATE INDEX idx_port_mappings_expiry
                    ON port_mappings(enabled, expires_at);
                PRAGMA user_version = 15;
            `)
            dbOf(existing).close()

            const migrated = new Store(dbPath)
            const columns = dbOf(migrated)
                .prepare('PRAGMA table_info(port_mappings)')
                .all()
                .map((row) => (row as { name: string }).name)
            expect(columns).toContain('target_type')
            expect(columns).toContain('static_path')
            const version = dbOf(migrated).prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(16)
            dbOf(migrated).close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('creates, lists, updates, disables, enables, and expires port mappings', () => {
        const store = new Store(':memory:')

        const created = store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            targetType: 'port',
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
            targetType: 'port',
            port: 8080,
            targetHost: '127.0.0.1',
            staticPath: null,
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
            targetType: 'port',
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

    it('creates static mappings with a static path and updates that path', () => {
        const store = new Store(':memory:')
        const created = store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_dist',
            targetType: 'static',
            staticPath: 'dist',
            durationMs: 30 * 60_000,
            accessTokenHash: 'hash-static',
            now: 1_000
        })

        expect(created).toMatchObject({
            alias: 'repo_dist',
            targetType: 'static',
            staticPath: 'dist',
            port: 0,
            targetHost: ''
        })

        const updated = store.portMappings.update('default', created.id, {
            staticPath: 'build'
        }, 2_000)
        expect(updated).toMatchObject({
            targetType: 'static',
            staticPath: 'build',
            port: 0
        })
    })

    it('keeps aliases unique per namespace', () => {
        const store = new Store(':memory:')
        store.portMappings.create({
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            targetType: 'port',
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
            targetType: 'static',
            staticPath: 'dist',
            durationMs: 60_000,
            accessTokenHash: 'hash-2',
            now: 1_000
        })).toThrow()

        expect(store.portMappings.create({
            namespace: 'other',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: 'repo_8080',
            targetType: 'port',
            port: 8080,
            durationMs: 60_000,
            accessTokenHash: 'hash-3',
            now: 1_000
        })).toMatchObject({ namespace: 'other', alias: 'repo_8080' })
    })
})
