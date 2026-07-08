import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { StoredPortMapping } from './types'

type DbPortMappingRow = {
    id: string
    namespace: string
    machine_id: string
    project_path: string
    alias: string
    target_type: 'port' | 'static'
    port: number
    target_host: string
    static_path: string | null
    enabled: number
    duration_ms: number
    expires_at: number | null
    last_enabled_at: number | null
    access_token_hash: string
    created_at: number
    updated_at: number
}

type PortMappingTargetInput =
    | {
        targetType: 'port'
        port: number
        targetHost?: string
        staticPath?: never
    }
    | {
        targetType: 'static'
        staticPath: string
        port?: never
        targetHost?: never
    }

export type CreatePortMappingInput = {
    namespace: string
    machineId: string
    projectPath: string
    alias: string
    durationMs: number
    accessTokenHash: string
    now?: number
} & PortMappingTargetInput

export type ListPortMappingsOptions = {
    namespace: string
    machineId?: string
    projectPath?: string
}

export type UpdatePortMappingInput = {
    alias?: string
    port?: number
    staticPath?: string
    durationMs?: number
}

function toStoredPortMapping(row: DbPortMappingRow): StoredPortMapping {
    return {
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        projectPath: row.project_path,
        alias: row.alias,
        targetType: row.target_type,
        port: row.port,
        targetHost: row.target_host,
        staticPath: row.static_path,
        enabled: row.enabled === 1,
        durationMs: row.duration_ms,
        expiresAt: row.expires_at,
        lastEnabledAt: row.last_enabled_at,
        accessTokenHash: row.access_token_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

export class PortMappingsStore {
    constructor(private readonly db: Database) {}

    create(input: CreatePortMappingInput): StoredPortMapping {
        const now = input.now ?? Date.now()
        const id = randomUUID()
        const expiresAt = now + input.durationMs

        this.db.prepare(`
            INSERT INTO port_mappings (
                id, namespace, machine_id, project_path, alias, target_type, port, target_host,
                static_path, enabled, duration_ms, expires_at, last_enabled_at, access_token_hash,
                created_at, updated_at
            ) VALUES (
                @id, @namespace, @machine_id, @project_path, @alias, @target_type, @port, @target_host,
                @static_path, 1, @duration_ms, @expires_at, @last_enabled_at, @access_token_hash,
                @created_at, @updated_at
            )
        `).run({
            id,
            namespace: input.namespace,
            machine_id: input.machineId,
            project_path: input.projectPath,
            alias: input.alias,
            target_type: input.targetType,
            port: input.targetType === 'port' ? input.port : 0,
            target_host: input.targetType === 'port' ? (input.targetHost ?? '127.0.0.1') : '',
            static_path: input.targetType === 'static' ? input.staticPath : null,
            duration_ms: input.durationMs,
            expires_at: expiresAt,
            last_enabled_at: now,
            access_token_hash: input.accessTokenHash,
            created_at: now,
            updated_at: now
        })

        const created = this.get(input.namespace, id)
        if (!created) {
            throw new Error('Failed to create port mapping')
        }
        return created
    }

    get(namespace: string, id: string): StoredPortMapping | null {
        const row = this.db.prepare('SELECT * FROM port_mappings WHERE namespace = ? AND id = ?')
            .get(namespace, id) as DbPortMappingRow | undefined
        return row ? toStoredPortMapping(row) : null
    }

    getByAliasAndTokenHash(alias: string, accessTokenHash: string): StoredPortMapping | null {
        const row = this.db.prepare('SELECT * FROM port_mappings WHERE alias = ? AND access_token_hash = ?')
            .get(alias, accessTokenHash) as DbPortMappingRow | undefined
        return row ? toStoredPortMapping(row) : null
    }

    list(options: ListPortMappingsOptions): StoredPortMapping[] {
        const where = ['namespace = @namespace']
        const params: Record<string, string | number> = { namespace: options.namespace }
        if (options.machineId) {
            where.push('machine_id = @machine_id')
            params.machine_id = options.machineId
        }
        if (options.projectPath) {
            where.push('project_path = @project_path')
            params.project_path = options.projectPath
        }

        const rows = this.db.prepare(`
            SELECT * FROM port_mappings
            WHERE ${where.join(' AND ')}
            ORDER BY updated_at DESC, created_at DESC
        `).all(params) as DbPortMappingRow[]
        return rows.map(toStoredPortMapping)
    }

    update(namespace: string, id: string, input: UpdatePortMappingInput, now: number = Date.now()): StoredPortMapping | null {
        const current = this.get(namespace, id)
        if (!current) {
            return null
        }

        const nextDurationMs = input.durationMs ?? current.durationMs
        const nextExpiresAt = current.enabled && current.expiresAt !== null
            ? Math.max(current.expiresAt, now + nextDurationMs)
            : current.expiresAt

        this.db.prepare(`
            UPDATE port_mappings
            SET alias = @alias,
                port = @port,
                static_path = @static_path,
                duration_ms = @duration_ms,
                expires_at = @expires_at,
                updated_at = @updated_at
            WHERE namespace = @namespace AND id = @id
        `).run({
            namespace,
            id,
            alias: input.alias ?? current.alias,
            port: current.targetType === 'port' ? (input.port ?? current.port) : current.port,
            static_path: current.targetType === 'static' ? (input.staticPath ?? current.staticPath) : current.staticPath,
            duration_ms: nextDurationMs,
            expires_at: nextExpiresAt,
            updated_at: now
        })

        return this.get(namespace, id)
    }

    enable(namespace: string, id: string, input: { durationMs?: number; accessTokenHash: string }, now: number = Date.now()): StoredPortMapping | null {
        const current = this.get(namespace, id)
        if (!current) {
            return null
        }
        const durationMs = input.durationMs ?? current.durationMs
        this.db.prepare(`
            UPDATE port_mappings
            SET enabled = 1,
                duration_ms = @duration_ms,
                expires_at = @expires_at,
                last_enabled_at = @last_enabled_at,
                access_token_hash = @access_token_hash,
                updated_at = @updated_at
            WHERE namespace = @namespace AND id = @id
        `).run({
            namespace,
            id,
            duration_ms: durationMs,
            expires_at: now + durationMs,
            last_enabled_at: now,
            access_token_hash: input.accessTokenHash,
            updated_at: now
        })
        return this.get(namespace, id)
    }

    disable(namespace: string, id: string, now: number = Date.now()): StoredPortMapping | null {
        this.db.prepare(`
            UPDATE port_mappings
            SET enabled = 0, updated_at = @updated_at
            WHERE namespace = @namespace AND id = @id
        `).run({ namespace, id, updated_at: now })
        return this.get(namespace, id)
    }

    delete(namespace: string, id: string): boolean {
        const result = this.db.prepare('DELETE FROM port_mappings WHERE namespace = ? AND id = ?')
            .run(namespace, id)
        return result.changes > 0
    }

    listExpired(now: number = Date.now()): StoredPortMapping[] {
        const rows = this.db.prepare(`
            SELECT * FROM port_mappings
            WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at <= ?
        `).all(now) as DbPortMappingRow[]
        return rows.map(toStoredPortMapping)
    }

    expire(now: number = Date.now()): StoredPortMapping[] {
        const expired = this.listExpired(now)
        if (expired.length === 0) {
            return []
        }
        this.db.prepare(`
            UPDATE port_mappings
            SET enabled = 0, updated_at = @updated_at
            WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at <= @now
        `).run({ now, updated_at: now })
        return expired.map((mapping) => ({ ...mapping, enabled: false, updatedAt: now }))
    }
}
