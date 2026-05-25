import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

function tableNames(store: Store): string[] {
    return (store as unknown as { db: Database }).db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name)
}

describe('CronRunsStore', () => {
    it('fresh schema creates cron registry and run history tables with unique scheduled run key', () => {
        const store = new Store(':memory:')

        expect(tableNames(store)).toContain('cron_projects')
        expect(tableNames(store)).toContain('cron_runs')

        const indexes = (store as unknown as { db: Database }).db
            .prepare("PRAGMA index_list(cron_runs)")
            .all() as Array<{ name: string; unique: number }>
        const uniqueIndexes = indexes.filter((index) => index.unique === 1).map((index) => index.name)
        expect(uniqueIndexes.length).toBeGreaterThanOrEqual(1)
        const uniqueRunIndex = uniqueIndexes.find((name) => name !== 'sqlite_autoindex_cron_runs_1')
        expect(uniqueRunIndex).toBeTruthy()
        const uniqueColumns = (store as unknown as { db: Database }).db
            .prepare(`PRAGMA index_info('${uniqueRunIndex}')`)
            .all()
            .map((row) => (row as { name: string }).name)
        expect(uniqueColumns).toEqual(['namespace', 'machine_id', 'project_path', 'cron_id', 'scheduled_at'])
    })

    it('migrates a v10 database to add cron tables', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-cron-store-migration-'))
        const dbPath = join(dir, 'test.db')
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec(`
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    tag TEXT,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    machine_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    agent_state TEXT,
                    agent_state_version INTEGER DEFAULT 1,
                    model TEXT,
                    model_reasoning_effort TEXT,
                    service_tier TEXT,
                    effort TEXT,
                    permission_mode TEXT,
                    todos TEXT,
                    todos_updated_at INTEGER,
                    team_state TEXT,
                    team_state_updated_at INTEGER,
                    marker_color TEXT,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
                CREATE TABLE machines (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    runner_state TEXT,
                    runner_state_version INTEGER DEFAULT 1,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
                CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    seq INTEGER NOT NULL,
                    local_id TEXT,
                    invoked_at INTEGER
                );
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL,
                    platform_user_id TEXT NOT NULL,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    UNIQUE(platform, platform_user_id)
                );
                CREATE TABLE push_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    UNIQUE(namespace, endpoint)
                );
                PRAGMA user_version = 10;
            `)
            db.close()

            const store = new Store(dbPath)
            expect(tableNames(store)).toContain('cron_projects')
            expect(tableNames(store)).toContain('cron_runs')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('registers projects idempotently and lists enabled projects', () => {
        const store = new Store(':memory:')

        store.cronRuns.registerProject({ namespace: 'default', machineId: 'm1', projectPath: '/repo', now: 100 })
        store.cronRuns.registerProject({ namespace: 'default', machineId: 'm1', projectPath: '/repo', now: 200 })
        store.cronRuns.registerProject({ namespace: 'other', machineId: 'm1', projectPath: '/repo', enabled: false, now: 300 })

        const enabled = store.cronRuns.listProjects({ enabledOnly: true })
        expect(enabled).toHaveLength(1)
        expect(enabled[0]).toMatchObject({
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            enabled: true,
            lastSeenAt: 200
        })
    })

    it('deduplicates cron runs by namespace machine project cron and scheduledAt', () => {
        const store = new Store(':memory:')

        const first = store.cronRuns.createRunIfAbsent({
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            cronId: 'daily',
            scheduledAt: 1_000,
            now: 1_000
        })
        const second = store.cronRuns.createRunIfAbsent({
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            cronId: 'daily',
            scheduledAt: 1_000,
            now: 2_000
        })

        expect(second.id).toBe(first.id)
        expect(store.cronRuns.listRuns({ namespace: 'default' })).toHaveLength(1)
    })

    it('claims queued runs once and records session/completion state transitions', () => {
        const store = new Store(':memory:')
        const run = store.cronRuns.createRunIfAbsent({
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            cronId: 'daily',
            scheduledAt: 1_000,
            now: 1_000
        })

        const claimed = store.cronRuns.claimRun({ id: run.id, now: 1_100 })
        expect(claimed?.status).toBe('running')
        expect(claimed?.startedAt).toBe(1_100)
        expect(store.cronRuns.claimRun({ id: run.id, now: 1_200 })).toBeNull()

        expect(store.cronRuns.attachSession(run.id, 'session-1', 1_300)).toBe(true)
        const finished = store.cronRuns.finishRun({ id: run.id, status: 'completed', now: 1_400 })
        expect(finished).toMatchObject({
            id: run.id,
            sessionId: 'session-1',
            status: 'completed',
            finishedAt: 1_400,
            error: null
        })
    })
})
