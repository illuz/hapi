import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { CronRunsStore } from './cronRunsStore'
import { HistoryStore } from './historyStore'
import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { PortMappingsStore } from './portMappingsStore'
import { PushStore } from './pushStore'
import { SessionShareStore } from './sessionShareStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'

export type {
    StoredCronProject,
    StoredCronRun,
    StoredHistoryEntry,
    StoredMachine,
    StoredMessage,
    StoredPortMapping,
    StoredPushSubscription,
    StoredSession,
    StoredSessionShare,
    StoredUser,
    VersionedUpdateResult
} from './types'
export type { CancelQueuedMessageResult, LookupQueuedMessageResult } from './messages'
export { CronRunsStore } from './cronRunsStore'
export { HistoryStore } from './historyStore'
export type {
    AddHistoryEntryInput,
    MergeHistoryEntriesResult,
    SearchHistoryOptions,
    SearchHistoryResult,
    HistorySearchScope
} from './historyStore'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { PortMappingsStore } from './portMappingsStore'
export { PushStore } from './pushStore'
export { SessionShareStore } from './sessionShareStore'
export { SessionStore } from './sessionStore'
export { UserStore } from './userStore'

const SCHEMA_VERSION: number = 16
const REQUIRED_TABLES = [
    'sessions',
    'machines',
    'messages',
    'users',
    'push_subscriptions',
    'cron_projects',
    'cron_runs',
    'conversation_history',
    'session_shares',
    'port_mappings'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly portMappings: PortMappingsStore
    readonly users: UserStore
    readonly push: PushStore
    readonly sessionShares: SessionShareStore
    readonly cronRuns: CronRunsStore
    readonly history: HistoryStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.portMappings = new PortMappingsStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
        this.sessionShares = new SessionShareStore(this.db)
        this.cronRuns = new CronRunsStore(this.db)
        this.history = new HistoryStore(this.db)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        // V1/V2/V3 entries cover legacy DBs that pre-date our migration ladder.
        // Each step is idempotent (column-existence guards inside) so we can
        // safely run the full V1→V10 chain in the legacy branch where the DB
        // shape is unknown.
        const buildStepMigrations = (legacy: boolean): Record<number, () => void> => ({
            1: () => this.migrateFromV1ToV2(legacy),
            2: () => this.migrateFromV2ToV3(),
            3: () => this.migrateFromV3ToV4(),
            4: () => this.migrateFromV4ToV5(),
            5: () => this.migrateFromV5ToV6(),
            6: () => this.migrateFromV6ToV7(),
            7: () => this.migrateFromV7ToV8(),
            8: () => this.migrateFromV8ToV9(),
            9: () => this.migrateFromV9ToV10(),
            10: () => this.migrateFromV10ToV11(),
            11: () => this.migrateFromV11ToV12(),
            12: () => this.migrateFromV12ToV13(),
            13: () => this.migrateFromV13ToV14(),
            14: () => this.migrateFromV14ToV15(),
            15: () => this.migrateFromV15ToV16(),
        })

        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                // Run the full step ladder BEFORE createSchema so legacy tables
                // pick up every later-version column (e.g. invoked_at) via ALTER
                // TABLE.  Without this, createSchema below would try to build
                // idx_messages_session_position over a column that does not
                // exist yet, and CREATE TABLE IF NOT EXISTS would not add the
                // missing column to the existing table.
                const legacySteps = buildStepMigrations(true)
                for (let v = 1; v < SCHEMA_VERSION; v++) {
                    legacySteps[v]?.()
                }
                // Backfill any *missing* tables (sessions, machines, ...) that
                // a partially-built legacy DB may not have yet.
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        const stepMigrations = buildStepMigrations(false)

        // Repair historically possible V8-shape DBs before continuing the normal
        // ladder. Some V8 databases were stamped before invoked_at/index creation
        // completed; later migrations assume the V8 additions are present.
        if (currentVersion >= 8) {
            this.repairLatestSchemaIfNeeded()
        }

        if (currentVersion === 8 && SCHEMA_VERSION === 9) {
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion < SCHEMA_VERSION && stepMigrations[currentVersion]) {
            for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
                const step = stepMigrations[v]
                if (!step) throw this.buildSchemaMismatchError(currentVersion)
                step()
            }
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 9) {
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION === 9) {
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 9) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 9) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.repairLatestSchemaIfNeeded()
        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
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
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS machines (
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
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                invoked_at INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

            CREATE TABLE IF NOT EXISTS cron_projects (
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_seen_at INTEGER NOT NULL,
                last_loaded_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, machine_id, project_path)
            );
            CREATE INDEX IF NOT EXISTS idx_cron_projects_namespace ON cron_projects(namespace);
            CREATE INDEX IF NOT EXISTS idx_cron_projects_machine ON cron_projects(machine_id, namespace);

            CREATE TABLE IF NOT EXISTS cron_runs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                cron_id TEXT NOT NULL,
                session_id TEXT,
                status TEXT NOT NULL,
                scheduled_at INTEGER NOT NULL,
                queued_at INTEGER NOT NULL,
                started_at INTEGER,
                finished_at INTEGER,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, machine_id, project_path, cron_id, scheduled_at)
            );
            CREATE INDEX IF NOT EXISTS idx_cron_runs_namespace_project ON cron_runs(namespace, machine_id, project_path);
            CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_cron_runs_session ON cron_runs(session_id) WHERE session_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS conversation_history (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                session_id TEXT NOT NULL,
                user_message_id TEXT,
                assistant_message_id TEXT,
                created_at INTEGER NOT NULL,
                title TEXT NOT NULL,
                project_path TEXT,
                project_host TEXT,
                marker_color TEXT,
                user_text TEXT NOT NULL,
                assistant_excerpt TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_conversation_history_namespace_created ON conversation_history(namespace, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_history_session ON conversation_history(namespace, session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_history_project ON conversation_history(namespace, project_path, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_history_assistant_message
                ON conversation_history(session_id, assistant_message_id)
                WHERE assistant_message_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS port_mappings (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                alias TEXT NOT NULL,
                target_type TEXT NOT NULL DEFAULT 'port',
                port INTEGER NOT NULL,
                target_host TEXT NOT NULL DEFAULT '127.0.0.1',
                static_path TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                duration_ms INTEGER NOT NULL,
                expires_at INTEGER,
                last_enabled_at INTEGER,
                access_token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, alias)
            );
            CREATE INDEX IF NOT EXISTS idx_port_mappings_namespace_project
                ON port_mappings(namespace, machine_id, project_path);
            CREATE INDEX IF NOT EXISTS idx_port_mappings_alias
                ON port_mappings(alias);
            CREATE INDEX IF NOT EXISTS idx_port_mappings_expiry
                ON port_mappings(enabled, expires_at);

            CREATE TABLE IF NOT EXISTS session_shares (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                session_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                token_encrypted TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                label TEXT,
                visible_from_seq INTEGER NOT NULL DEFAULT 0,
                expires_at INTEGER,
                revoked_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_shares_session
                ON session_shares(namespace, session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_session_shares_active
                ON session_shares(namespace, session_id, revoked_at, expires_at);
        `)
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(legacy: boolean = false): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            // In the legacy branch the table may not exist yet — createSchema
            // will build the up-to-date one.  When invoked from the regular
            // upgrade path (user_version >= 1), missing the machines table is
            // still an error.
            if (legacy) return
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            if (legacy) return
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
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
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const columns = this.getSessionColumnNames()
        // When the legacy branch invokes the full step ladder, an upstream-only
        // DB may not have the sessions table yet — createSchema runs after the
        // ladder.  Skip ALTERs in that case; createSchema will build the table
        // with the up-to-date columns.
        if (columns.size === 0) return
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV4ToV5(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('model')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
        }
    }

    private migrateFromV5ToV6(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
        }
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private migrateFromV6ToV7(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) {
            throw new Error('SQLite schema missing sessions table for v6 to v7 migration.')
        }

        if (!columns.has('starred')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
        }

        if (!columns.has('model_reasoning_effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
        }
    }

    private migrateFromV7ToV8(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size === 0) {
            throw new Error('SQLite schema missing sessions table for v7 to v8 migration.')
        }

        if (!sessionColumns.has('marker_color')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN marker_color TEXT')
        }

        if (sessionColumns.has('starred')) {
            this.db.exec("UPDATE sessions SET marker_color = 'yellow' WHERE starred = 1 AND marker_color IS NULL")
        }

        const messageColumns = this.getMessageColumnNames()
        if (messageColumns.size === 0) {
            // No messages table yet — createSchema will build the up-to-date one.
            return
        }
        if (!messageColumns.has('invoked_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN invoked_at INTEGER')
        }
        // Idempotent (WHERE invoked_at IS NULL); safe to re-run if a previous attempt
        // crashed between ALTER and UPDATE before user_version was bumped.
        this.db.exec('UPDATE messages SET invoked_at = created_at WHERE invoked_at IS NULL')
        // Position index for byPosition pagination — idempotent via IF NOT EXISTS.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)
        `)
    }

    private migrateFromV8ToV9(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size === 0) {
            throw new Error('SQLite schema missing sessions table for v8 to v9 migration.')
        }

        if (!sessionColumns.has('permission_mode')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN permission_mode TEXT')
        }
    }

    private migrateFromV9ToV10(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size === 0) {
            throw new Error('SQLite schema missing sessions table for v9 to v10 migration.')
        }

        if (!sessionColumns.has('service_tier')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN service_tier TEXT')
        }
    }

    private migrateFromV10ToV11(): void {
        this.createCronSchema()
    }

    private migrateFromV11ToV12(): void {
        this.createHistorySchema()
    }

    private migrateFromV12ToV13(): void {
        this.ensureHistoryProjectHostColumn()
    }

    private migrateFromV13ToV14(): void {
        this.createSessionShareSchema()
    }

    private migrateFromV14ToV15(): void {
        this.createPortMappingSchema()
    }

    private migrateFromV15ToV16(): void {
        this.ensurePortMappingColumns()
    }

    private getMessageColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private repairLatestSchemaIfNeeded(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size > 0) {
            if (!sessionColumns.has('model_reasoning_effort')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
            }
            if (!sessionColumns.has('marker_color')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN marker_color TEXT')
            }
            if (!sessionColumns.has('permission_mode')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN permission_mode TEXT')
            }
            if (!sessionColumns.has('service_tier')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN service_tier TEXT')
            }
        }

        this.createCronSchema()
        this.createHistorySchema()
        this.ensureHistoryProjectHostColumn()
        this.createSessionShareSchema()
        this.createPortMappingSchema()

        const messageColumns = this.getMessageColumnNames()
        if (messageColumns.size === 0) {
            return
        }

        if (!messageColumns.has('invoked_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN invoked_at INTEGER')
            this.db.exec('UPDATE messages SET invoked_at = created_at WHERE invoked_at IS NULL')
        }

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)
        `)
    }

    private createCronSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS cron_projects (
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_seen_at INTEGER NOT NULL,
                last_loaded_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, machine_id, project_path)
            );
            CREATE INDEX IF NOT EXISTS idx_cron_projects_namespace ON cron_projects(namespace);
            CREATE INDEX IF NOT EXISTS idx_cron_projects_machine ON cron_projects(machine_id, namespace);

            CREATE TABLE IF NOT EXISTS cron_runs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                cron_id TEXT NOT NULL,
                session_id TEXT,
                status TEXT NOT NULL,
                scheduled_at INTEGER NOT NULL,
                queued_at INTEGER NOT NULL,
                started_at INTEGER,
                finished_at INTEGER,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, machine_id, project_path, cron_id, scheduled_at)
            );
            CREATE INDEX IF NOT EXISTS idx_cron_runs_namespace_project ON cron_runs(namespace, machine_id, project_path);
            CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_cron_runs_session ON cron_runs(session_id) WHERE session_id IS NOT NULL;
        `)
    }

    private ensureHistoryProjectHostColumn(): void {
        const rows = this.db.prepare('PRAGMA table_info(conversation_history)').all() as Array<{ name: string }>
        if (rows.length === 0) return
        if (!rows.some((row) => row.name === 'project_host')) {
            this.db.exec('ALTER TABLE conversation_history ADD COLUMN project_host TEXT')
        }
    }

    private createHistorySchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversation_history (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                session_id TEXT NOT NULL,
                user_message_id TEXT,
                assistant_message_id TEXT,
                created_at INTEGER NOT NULL,
                title TEXT NOT NULL,
                project_path TEXT,
                project_host TEXT,
                marker_color TEXT,
                user_text TEXT NOT NULL,
                assistant_excerpt TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_conversation_history_namespace_created ON conversation_history(namespace, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_history_session ON conversation_history(namespace, session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_history_project ON conversation_history(namespace, project_path, created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_history_assistant_message
                ON conversation_history(session_id, assistant_message_id)
                WHERE assistant_message_id IS NOT NULL;
        `)
    }

    private createPortMappingSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS port_mappings (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                alias TEXT NOT NULL,
                target_type TEXT NOT NULL DEFAULT 'port',
                port INTEGER NOT NULL,
                target_host TEXT NOT NULL DEFAULT '127.0.0.1',
                static_path TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                duration_ms INTEGER NOT NULL,
                expires_at INTEGER,
                last_enabled_at INTEGER,
                access_token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, alias)
            );
            CREATE INDEX IF NOT EXISTS idx_port_mappings_namespace_project
                ON port_mappings(namespace, machine_id, project_path);
            CREATE INDEX IF NOT EXISTS idx_port_mappings_alias
                ON port_mappings(alias);
            CREATE INDEX IF NOT EXISTS idx_port_mappings_expiry
                ON port_mappings(enabled, expires_at);
        `)
        this.ensurePortMappingColumns()
    }

    private ensurePortMappingColumns(): void {
        const rows = this.db.prepare('PRAGMA table_info(port_mappings)').all() as Array<{ name: string }>
        if (rows.length === 0) {
            return
        }
        if (!rows.some((row) => row.name === 'target_type')) {
            this.db.exec("ALTER TABLE port_mappings ADD COLUMN target_type TEXT NOT NULL DEFAULT 'port'")
        }
        if (!rows.some((row) => row.name === 'static_path')) {
            this.db.exec('ALTER TABLE port_mappings ADD COLUMN static_path TEXT')
        }
    }

    private createSessionShareSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_shares (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                session_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                token_encrypted TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                label TEXT,
                visible_from_seq INTEGER NOT NULL DEFAULT 0,
                expires_at INTEGER,
                revoked_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_used_at INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_shares_session
                ON session_shares(namespace, session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_session_shares_active
                ON session_shares(namespace, session_id, revoked_at, expires_at);
        `)
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
