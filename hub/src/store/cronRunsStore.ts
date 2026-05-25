import type { CronRunStatus } from '@hapi/protocol/projectTools'
import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredCronProject, StoredCronRun } from './types'

type DbCronProjectRow = {
    namespace: string
    machine_id: string
    project_path: string
    enabled: number
    last_seen_at: number
    last_loaded_at: number | null
    created_at: number
    updated_at: number
}

type DbCronRunRow = {
    id: string
    namespace: string
    machine_id: string
    project_path: string
    cron_id: string
    session_id: string | null
    status: CronRunStatus
    scheduled_at: number
    queued_at: number
    started_at: number | null
    finished_at: number | null
    error: string | null
    created_at: number
    updated_at: number
}

export type RegisterCronProjectParams = {
    namespace: string
    machineId: string
    projectPath: string
    enabled?: boolean
    now?: number
}

export type ListCronProjectsOptions = {
    namespace?: string
    enabledOnly?: boolean
}

export type CreateCronRunParams = {
    namespace: string
    machineId: string
    projectPath: string
    cronId: string
    scheduledAt: number
    status?: CronRunStatus
    now?: number
    error?: string | null
}

export type ClaimCronRunParams = {
    id: string
    now?: number
}

export type FinishCronRunParams = {
    id: string
    status: Extract<CronRunStatus, 'completed' | 'failed' | 'cancelled'>
    error?: string | null
    now?: number
}

export type ListCronRunsOptions = {
    namespace: string
    machineId?: string
    projectPath?: string
    cronId?: string
    status?: CronRunStatus
    limit?: number
}

export class CronRunsStore {
    constructor(private readonly db: Database) {
    }

    registerProject(params: RegisterCronProjectParams): StoredCronProject {
        const now = params.now ?? Date.now()
        const enabled = params.enabled === false ? 0 : 1
        this.db.prepare(`
            INSERT INTO cron_projects (
                namespace, machine_id, project_path, enabled,
                last_seen_at, last_loaded_at, created_at, updated_at
            ) VALUES (
                @namespace, @machine_id, @project_path, @enabled,
                @last_seen_at, NULL, @created_at, @updated_at
            )
            ON CONFLICT(namespace, machine_id, project_path) DO UPDATE SET
                enabled = excluded.enabled,
                last_seen_at = excluded.last_seen_at,
                updated_at = excluded.updated_at
        `).run({
            namespace: params.namespace,
            machine_id: params.machineId,
            project_path: params.projectPath,
            enabled,
            last_seen_at: now,
            created_at: now,
            updated_at: now
        })

        const project = this.getProject(params.namespace, params.machineId, params.projectPath)
        if (!project) {
            throw new Error('Failed to register cron project')
        }
        return project
    }

    markProjectLoaded(namespace: string, machineId: string, projectPath: string, now: number = Date.now()): boolean {
        const result = this.db.prepare(`
            UPDATE cron_projects
            SET last_loaded_at = @last_loaded_at,
                last_seen_at = @last_seen_at,
                updated_at = @updated_at
            WHERE namespace = @namespace
              AND machine_id = @machine_id
              AND project_path = @project_path
        `).run({
            namespace,
            machine_id: machineId,
            project_path: projectPath,
            last_loaded_at: now,
            last_seen_at: now,
            updated_at: now
        })
        return result.changes > 0
    }

    getProject(namespace: string, machineId: string, projectPath: string): StoredCronProject | null {
        const row = this.db.prepare(`
            SELECT * FROM cron_projects
            WHERE namespace = ? AND machine_id = ? AND project_path = ?
        `).get(namespace, machineId, projectPath) as DbCronProjectRow | undefined
        return row ? toStoredCronProject(row) : null
    }

    listProjects(options: ListCronProjectsOptions = {}): StoredCronProject[] {
        const where: string[] = []
        const params: Record<string, unknown> = {}

        if (options.namespace) {
            where.push('namespace = @namespace')
            params.namespace = options.namespace
        }
        if (options.enabledOnly) {
            where.push('enabled = 1')
        }

        const sql = `
            SELECT * FROM cron_projects
            ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY updated_at DESC
        `
        const rows = this.db.prepare(sql).all(params as Record<string, string | number | boolean | null>) as DbCronProjectRow[]
        return rows.map(toStoredCronProject)
    }

    createRunIfAbsent(params: CreateCronRunParams): StoredCronRun {
        const now = params.now ?? Date.now()
        const status = params.status ?? 'queued'
        const id = randomUUID()
        this.db.prepare(`
            INSERT OR IGNORE INTO cron_runs (
                id, namespace, machine_id, project_path, cron_id, session_id,
                status, scheduled_at, queued_at, started_at, finished_at,
                error, created_at, updated_at
            ) VALUES (
                @id, @namespace, @machine_id, @project_path, @cron_id, NULL,
                @status, @scheduled_at, @queued_at, NULL, @finished_at,
                @error, @created_at, @updated_at
            )
        `).run({
            id,
            namespace: params.namespace,
            machine_id: params.machineId,
            project_path: params.projectPath,
            cron_id: params.cronId,
            status,
            scheduled_at: params.scheduledAt,
            queued_at: now,
            finished_at: status === 'queued' || status === 'running' ? null : now,
            error: params.error ?? null,
            created_at: now,
            updated_at: now
        })

        const run = this.getRunByUniqueKey(
            params.namespace,
            params.machineId,
            params.projectPath,
            params.cronId,
            params.scheduledAt
        )
        if (!run) {
            throw new Error('Failed to create cron run')
        }
        return run
    }

    claimRun(params: ClaimCronRunParams): StoredCronRun | null {
        const now = params.now ?? Date.now()
        const result = this.db.prepare(`
            UPDATE cron_runs
            SET status = 'running',
                started_at = @started_at,
                updated_at = @updated_at
            WHERE id = @id AND status = 'queued'
        `).run({
            id: params.id,
            started_at: now,
            updated_at: now
        })

        if (result.changes === 0) {
            return null
        }
        return this.getRun(params.id)
    }

    attachSession(id: string, sessionId: string, now: number = Date.now()): boolean {
        const result = this.db.prepare(`
            UPDATE cron_runs
            SET session_id = @session_id,
                updated_at = @updated_at
            WHERE id = @id
        `).run({ id, session_id: sessionId, updated_at: now })
        return result.changes > 0
    }

    finishRun(params: FinishCronRunParams): StoredCronRun | null {
        const now = params.now ?? Date.now()
        const result = this.db.prepare(`
            UPDATE cron_runs
            SET status = @status,
                finished_at = @finished_at,
                error = @error,
                updated_at = @updated_at
            WHERE id = @id AND status = 'running'
        `).run({
            id: params.id,
            status: params.status,
            finished_at: now,
            error: params.error ?? null,
            updated_at: now
        })

        if (result.changes === 0) {
            return null
        }
        return this.getRun(params.id)
    }

    getRun(id: string): StoredCronRun | null {
        const row = this.db.prepare('SELECT * FROM cron_runs WHERE id = ?').get(id) as DbCronRunRow | undefined
        return row ? toStoredCronRun(row) : null
    }

    getRunByUniqueKey(
        namespace: string,
        machineId: string,
        projectPath: string,
        cronId: string,
        scheduledAt: number
    ): StoredCronRun | null {
        const row = this.db.prepare(`
            SELECT * FROM cron_runs
            WHERE namespace = ?
              AND machine_id = ?
              AND project_path = ?
              AND cron_id = ?
              AND scheduled_at = ?
        `).get(namespace, machineId, projectPath, cronId, scheduledAt) as DbCronRunRow | undefined
        return row ? toStoredCronRun(row) : null
    }

    getLastRunForCron(params: {
        namespace: string
        machineId: string
        projectPath: string
        cronId: string
    }): StoredCronRun | null {
        const row = this.db.prepare(`
            SELECT * FROM cron_runs
            WHERE namespace = @namespace
              AND machine_id = @machine_id
              AND project_path = @project_path
              AND cron_id = @cron_id
            ORDER BY scheduled_at DESC, created_at DESC
            LIMIT 1
        `).get({
            namespace: params.namespace,
            machine_id: params.machineId,
            project_path: params.projectPath,
            cron_id: params.cronId
        }) as DbCronRunRow | undefined
        return row ? toStoredCronRun(row) : null
    }

    listRuns(options: ListCronRunsOptions): StoredCronRun[] {
        const where = ['namespace = @namespace']
        const params: Record<string, unknown> = { namespace: options.namespace }

        if (options.machineId) {
            where.push('machine_id = @machine_id')
            params.machine_id = options.machineId
        }
        if (options.projectPath) {
            where.push('project_path = @project_path')
            params.project_path = options.projectPath
        }
        if (options.cronId) {
            where.push('cron_id = @cron_id')
            params.cron_id = options.cronId
        }
        if (options.status) {
            where.push('status = @status')
            params.status = options.status
        }

        const limit = Math.max(1, Math.min(options.limit ?? 100, 500))
        params.limit = limit

        const rows = this.db.prepare(`
            SELECT * FROM cron_runs
            WHERE ${where.join(' AND ')}
            ORDER BY scheduled_at DESC, created_at DESC
            LIMIT @limit
        `).all(params as Record<string, string | number | boolean | null>) as DbCronRunRow[]
        return rows.map(toStoredCronRun)
    }
}

function toStoredCronProject(row: DbCronProjectRow): StoredCronProject {
    return {
        namespace: row.namespace,
        machineId: row.machine_id,
        projectPath: row.project_path,
        enabled: row.enabled === 1,
        lastSeenAt: row.last_seen_at,
        lastLoadedAt: row.last_loaded_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredCronRun(row: DbCronRunRow): StoredCronRun {
    return {
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        projectPath: row.project_path,
        cronId: row.cron_id,
        sessionId: row.session_id,
        status: row.status,
        scheduledAt: row.scheduled_at,
        queuedAt: row.queued_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}
