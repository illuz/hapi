import { createHash, randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import type { PortMapping, PortMappingStatus, PortProxyFetchResponse } from '@hapi/protocol/portMappings'
import type { SyncEvent } from '@hapi/protocol/types'
import type { Store, StoredPortMapping } from '../store'
import type { RpcGateway } from './rpcGateway'

export const DEFAULT_PORT_MAPPING_DURATION_MS = 30 * 60_000
export const PORT_MAPPING_TOKEN_QUERY_PARAM = 'hapi_port_token'
const DEFAULT_TARGET_HOST = '127.0.0.1'

export type PortMappingMutationResult =
    | { type: 'success'; mapping: PortMapping; accessToken?: string }
    | { type: 'error'; message: string; code: 'not_found' | 'alias_conflict' | 'invalid_state' | 'rpc_failed' | 'store_failed' }

export type PortMappingCheckResult =
    | { success: true }
    | { success: false; error: string }

export type ResolvedPortProxyMapping = {
    mapping: PortMapping
    stored: StoredPortMapping
}

export class PortMappingService {
    constructor(private readonly deps: {
        store: Store
        rpcGateway: RpcGateway
        emit: (event: SyncEvent) => void
    }) {}

    list(params: { namespace: string; machineId: string; projectPath: string }): PortMapping[] {
        const now = Date.now()
        return this.deps.store.portMappings
            .list({ namespace: params.namespace, machineId: params.machineId, projectPath: params.projectPath })
            .map((mapping) => this.toPublicMapping(mapping, now))
    }

    create(params: {
        namespace: string
        machineId: string
        projectPath: string
        alias?: string
        port: number
        durationMs?: number
    }): PortMappingMutationResult {
        const now = Date.now()
        const accessToken = generateAccessToken()
        const alias = params.alias ?? buildDefaultAlias(params.projectPath, params.port)
        try {
            const mapping = this.deps.store.portMappings.create({
                namespace: params.namespace,
                machineId: params.machineId,
                projectPath: params.projectPath,
                alias,
                port: params.port,
                targetHost: DEFAULT_TARGET_HOST,
                durationMs: params.durationMs ?? DEFAULT_PORT_MAPPING_DURATION_MS,
                accessTokenHash: hashAccessToken(accessToken),
                now
            })
            this.emitUpdated(mapping, this.getStatus(mapping, now))
            return { type: 'success', mapping: this.toPublicMapping(mapping, now), accessToken }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create port mapping'
            const code = /unique|constraint/i.test(message) ? 'alias_conflict' : 'store_failed'
            return { type: 'error', message, code }
        }
    }

    update(params: {
        namespace: string
        id: string
        alias?: string
        port?: number
        durationMs?: number
    }): PortMappingMutationResult {
        try {
            const mapping = this.deps.store.portMappings.update(params.namespace, params.id, {
                alias: params.alias,
                port: params.port,
                durationMs: params.durationMs
            })
            if (!mapping) {
                return { type: 'error', message: 'Port mapping not found', code: 'not_found' }
            }
            const now = Date.now()
            this.emitUpdated(mapping, this.getStatus(mapping, now))
            return { type: 'success', mapping: this.toPublicMapping(mapping, now) }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update port mapping'
            const code = /unique|constraint/i.test(message) ? 'alias_conflict' : 'store_failed'
            return { type: 'error', message, code }
        }
    }

    enable(params: { namespace: string; id: string; durationMs?: number }): PortMappingMutationResult {
        const now = Date.now()
        const accessToken = generateAccessToken()
        const mapping = this.deps.store.portMappings.enable(params.namespace, params.id, {
            durationMs: params.durationMs,
            accessTokenHash: hashAccessToken(accessToken)
        }, now)
        if (!mapping) {
            return { type: 'error', message: 'Port mapping not found', code: 'not_found' }
        }
        this.emitUpdated(mapping, this.getStatus(mapping, now))
        return { type: 'success', mapping: this.toPublicMapping(mapping, now), accessToken }
    }

    disable(params: { namespace: string; id: string }): PortMappingMutationResult {
        const mapping = this.deps.store.portMappings.disable(params.namespace, params.id)
        if (!mapping) {
            return { type: 'error', message: 'Port mapping not found', code: 'not_found' }
        }
        const now = Date.now()
        this.emitUpdated(mapping, this.getStatus(mapping, now))
        return { type: 'success', mapping: this.toPublicMapping(mapping, now) }
    }

    delete(params: { namespace: string; id: string }): PortMappingMutationResult {
        const existing = this.deps.store.portMappings.get(params.namespace, params.id)
        if (!existing) {
            return { type: 'error', message: 'Port mapping not found', code: 'not_found' }
        }
        const deleted = this.deps.store.portMappings.delete(params.namespace, params.id)
        if (!deleted) {
            return { type: 'error', message: 'Failed to delete port mapping', code: 'store_failed' }
        }
        this.emitUpdated(existing, 'disabled')
        return { type: 'success', mapping: this.toPublicMapping({ ...existing, enabled: false, updatedAt: Date.now() }) }
    }

    async check(params: { machineId: string; port: number; targetHost?: string }): Promise<PortMappingCheckResult> {
        try {
            return await this.deps.rpcGateway.checkPortMappingTarget(params.machineId, {
                port: params.port,
                targetHost: params.targetHost ?? DEFAULT_TARGET_HOST
            })
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Failed to check port' }
        }
    }

    async proxyFetch(params: {
        machineId: string
        port: number
        targetHost?: string
        method: string
        path: string
        headers?: Record<string, string>
        bodyBase64?: string
    }): Promise<PortProxyFetchResponse> {
        try {
            return await this.deps.rpcGateway.fetchPortMappingTarget(params.machineId, {
                port: params.port,
                targetHost: params.targetHost ?? DEFAULT_TARGET_HOST,
                method: params.method,
                path: params.path,
                headers: params.headers,
                bodyBase64: params.bodyBase64
            })
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Failed to proxy port request' }
        }
    }

    resolveProxyMapping(alias: string, accessTokens: string[]): ResolvedPortProxyMapping | null {
        const now = Date.now()
        for (const token of accessTokens) {
            const normalized = token.trim()
            if (!normalized) continue
            const stored = this.deps.store.portMappings.getByAliasAndTokenHash(alias, hashAccessToken(normalized))
            if (!stored) continue
            const status = this.getStatus(stored, now)
            if (status !== 'active') {
                if (stored.enabled) {
                    this.deps.store.portMappings.disable(stored.namespace, stored.id, now)
                    this.emitUpdated(stored, 'expired')
                }
                return null
            }
            return { stored, mapping: this.toPublicMapping(stored, now) }
        }
        return null
    }

    expireMappings(now: number = Date.now()): StoredPortMapping[] {
        const expired = this.deps.store.portMappings.expire(now)
        for (const mapping of expired) {
            this.emitUpdated(mapping, 'expired')
        }
        return expired
    }

    getCookieName(mappingId: string): string {
        return `hapi_port_${mappingId.replace(/[^A-Za-z0-9]/g, '_')}`
    }

    private toPublicMapping(mapping: StoredPortMapping, now: number = Date.now()): PortMapping {
        const status = this.getStatus(mapping, now)
        return {
            id: mapping.id,
            namespace: mapping.namespace,
            machineId: mapping.machineId,
            projectPath: mapping.projectPath,
            alias: mapping.alias,
            port: mapping.port,
            targetHost: mapping.targetHost,
            enabled: status === 'active',
            status,
            durationMs: mapping.durationMs,
            expiresAt: mapping.expiresAt,
            lastEnabledAt: mapping.lastEnabledAt,
            createdAt: mapping.createdAt,
            updatedAt: mapping.updatedAt
        }
    }

    private getStatus(mapping: StoredPortMapping, now: number = Date.now()): PortMappingStatus {
        if (mapping.enabled && mapping.expiresAt !== null && mapping.expiresAt > now) {
            return 'active'
        }
        if (mapping.expiresAt !== null && mapping.expiresAt <= now) {
            return 'expired'
        }
        return 'disabled'
    }

    private emitUpdated(mapping: StoredPortMapping, status: PortMappingStatus): void {
        this.deps.emit({
            type: 'port-mappings-updated',
            namespace: mapping.namespace,
            machineId: mapping.machineId,
            projectPath: mapping.projectPath,
            mappingId: mapping.id,
            alias: mapping.alias,
            status
        })
    }
}

export function generateAccessToken(): string {
    return randomBytes(24).toString('base64url')
}

export function hashAccessToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

export function buildDefaultAlias(projectPath: string, port: number): string {
    const rawName = basename(projectPath.trim().replace(/[\\/]+$/, '')) || 'project'
    const safeName = rawName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
    return `${safeName}_${port}`.slice(0, 80)
}
