import { isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import {
    ProjectAgentConfigSchema,
    ProjectCronConfigSchema,
    type ProjectAgentConfig,
    type ProjectCronConfig,
    type ProjectToolCountsResult,
    type ProjectToolKind
} from '@hapi/protocol/projectTools'
import type { StoredCronRun } from '../store'
import type { PermissionMode, Session, SyncEvent } from '@hapi/protocol/types'
import type { MessageSentFrom } from './messageService'
import type {
    RpcGateway,
    RpcProjectToolCountsResponse,
    RpcProjectToolListResponse,
    RpcProjectToolMutationResponse
} from './rpcGateway'

type AgentFlavor = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'

type ProjectToolMutationParams = {
    machineId: string
    namespace: string
    projectPath: string
    kind: ProjectToolKind
    id: string
    expectedHash?: string | null
}

export type ProjectToolCountsServiceResponse = {
    counts: ProjectToolCountsResult[]
    errors?: Array<{ machineId?: string; projectPath?: string; error: string }>
}

export type StartProjectAgentResult =
    | { type: 'success'; sessionId: string }
    | {
        type: 'error'
        message: string
        code:
            | 'agent_not_found'
            | 'agent_disabled'
            | 'invalid_agent_config'
            | 'invalid_permission_mode'
            | 'project_tools_rpc_failed'
            | 'spawn_failed'
            | 'session_inactive'
            | 'metadata_update_failed'
    }

export type StartProjectCronResult =
    | { type: 'success'; sessionId: string }
    | {
        type: 'error'
        message: string
        code:
            | 'cron_disabled'
            | 'invalid_permission_mode'
            | 'spawn_failed'
            | 'session_inactive'
            | 'metadata_update_failed'
            | 'prompt_send_failed'
    }

type ProjectToolStore = {
    sessions: {
        getSessionByNamespace: (sessionId: string, namespace: string) => {
            metadata: unknown | null
            metadataVersion: number
        } | null
        updateSessionMetadata: (
            sessionId: string,
            metadata: unknown,
            expectedVersion: number,
            namespace: string,
            options?: { touchUpdatedAt?: boolean }
        ) => { result: 'success' | 'version-mismatch' | 'error' }
    }
    cronRuns?: {
        registerProject: (params: {
            namespace: string
            machineId: string
            projectPath: string
            enabled?: boolean
        }) => unknown
        listRuns: (options: {
            namespace: string
            machineId?: string
            projectPath?: string
            cronId?: string
            limit?: number
        }) => StoredCronRun[]
    }
}

type ProjectToolsServiceDeps = {
    store: ProjectToolStore
    rpcGateway: RpcGateway
    emit: (event: SyncEvent) => void
    spawnSession: (
        machineId: string,
        directory: string,
        agent?: AgentFlavor,
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: string,
        permissionMode?: PermissionMode,
        serviceTier?: string
    ) => Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }>
    waitForSessionActive: (sessionId: string, timeoutMs?: number) => Promise<boolean>
    sendMessage: (
        sessionId: string,
        payload: { text: string; sentFrom: MessageSentFrom }
    ) => Promise<void>
    getSession: (sessionId: string) => Session | undefined
    refreshSession: (sessionId: string) => Session | null
    updateSessionAgentId?: (sessionId: string, namespace: string, agentId: string) => boolean
    archiveSession?: (sessionId: string) => Promise<void>
    waitForSessionEnd?: (sessionId: string, timeoutMs?: number) => Promise<boolean>
}

export class ProjectToolsService {
    constructor(private readonly deps: ProjectToolsServiceDeps) {
    }

    async listProjectTools(params: {
        machineId: string
        namespace?: string
        projectPath: string
        kind: ProjectToolKind
    }): Promise<RpcProjectToolListResponse> {
        try {
            const result = await this.deps.rpcGateway.listProjectTools(params.machineId, {
                projectPath: params.projectPath,
                kind: params.kind
            })
            if (params.namespace) {
                this.registerProject(params.namespace, params.machineId, result.success ? result.projectPath : params.projectPath)
            }
            return result
        } catch (error) {
            return { success: false, error: formatError(error, 'Failed to list project tools') }
        }
    }

    async countProjectTools(
        projects: Array<{ machineId: string; projectPath: string }>,
        namespace?: string
    ): Promise<ProjectToolCountsServiceResponse> {
        const counts: ProjectToolCountsResult[] = []
        const errors: Array<{ machineId?: string; projectPath?: string; error: string }> = []
        const projectsByMachineId = new Map<string, Array<{ machineId: string; projectPath: string }>>()

        for (const project of projects) {
            const existing = projectsByMachineId.get(project.machineId) ?? []
            existing.push(project)
            projectsByMachineId.set(project.machineId, existing)
        }

        for (const [machineId, machineProjects] of projectsByMachineId) {
            let result: RpcProjectToolCountsResponse
            try {
                result = await this.deps.rpcGateway.countProjectTools(machineId, machineProjects)
            } catch (error) {
                for (const project of machineProjects) {
                    errors.push({
                        machineId: project.machineId,
                        projectPath: project.projectPath,
                        error: formatError(error, 'Failed to count project tools')
                    })
                }
                continue
            }

            if (Array.isArray(result.counts)) {
                counts.push(...result.counts)
                if (namespace) {
                    for (const count of result.counts) {
                        this.registerProject(namespace, count.machineId, count.projectPath)
                    }
                }
            }

            if (Array.isArray(result.errors)) {
                errors.push(...result.errors)
            }

            if (!result.success && !result.errors?.length) {
                for (const project of machineProjects) {
                    errors.push({
                        machineId: project.machineId,
                        projectPath: project.projectPath,
                        error: result.error ?? 'Failed to count project tools'
                    })
                }
            }
        }

        return {
            counts,
            errors: errors.length > 0 ? errors : undefined
        }
    }

    async upsertProjectTool(
        params: ProjectToolMutationParams & { value: unknown }
    ): Promise<RpcProjectToolMutationResponse> {
        let result: RpcProjectToolMutationResponse
        try {
            result = await this.deps.rpcGateway.upsertProjectTool(params.machineId, {
                projectPath: params.projectPath,
                kind: params.kind,
                id: params.id,
                value: params.value,
                expectedHash: params.expectedHash
            })
        } catch (error) {
            return { success: false, error: formatError(error, 'Failed to upsert project tool') }
        }

        if (result.success) {
            this.registerProject(params.namespace, params.machineId, result.projectPath)
            this.emitProjectToolsUpdated(params.machineId, params.namespace, result.projectPath, result.kind)
        }

        return result
    }

    async deleteProjectTool(params: ProjectToolMutationParams): Promise<RpcProjectToolMutationResponse> {
        let result: RpcProjectToolMutationResponse
        try {
            result = await this.deps.rpcGateway.deleteProjectTool(params.machineId, {
                projectPath: params.projectPath,
                kind: params.kind,
                id: params.id,
                expectedHash: params.expectedHash
            })
        } catch (error) {
            return { success: false, error: formatError(error, 'Failed to delete project tool') }
        }

        if (result.success) {
            this.registerProject(params.namespace, params.machineId, result.projectPath)
            this.emitProjectToolsUpdated(params.machineId, params.namespace, result.projectPath, result.kind)
        }

        return result
    }

    async startProjectAgent(params: {
        machineId: string
        namespace: string
        projectPath: string
        agentId: string
    }): Promise<StartProjectAgentResult> {
        this.registerProject(params.namespace, params.machineId, params.projectPath)
        const configResult = await this.getAgentConfig(params.machineId, params.namespace, params.projectPath, params.agentId)
        if (configResult.type === 'error') {
            return configResult
        }

        const config = configResult.config
        if (config.enabled === false) {
            return { type: 'error', message: 'Project agent is disabled', code: 'agent_disabled' }
        }

        const agent = config.agent ?? 'claude'
        if (config.permissionMode && !isPermissionModeAllowedForFlavor(config.permissionMode, agent)) {
            return {
                type: 'error',
                message: `Permission mode ${config.permissionMode} is not supported by ${agent}`,
                code: 'invalid_permission_mode'
            }
        }

        const spawnResult = await this.deps.spawnSession(
            params.machineId,
            params.projectPath,
            agent,
            config.model,
            config.modelReasoningEffort,
            undefined,
            undefined,
            undefined,
            undefined,
            config.effort,
            config.permissionMode
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'spawn_failed' }
        }

        const becameActive = await this.deps.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'session_inactive' }
        }

        const metadataUpdated = this.writeSessionAgentMetadata(
            spawnResult.sessionId,
            params.namespace,
            {
                agentId: config.id,
                agentPrompt: config.prompt
            }
        )
        if (!metadataUpdated) {
            return { type: 'error', message: 'Failed to write session agent metadata', code: 'metadata_update_failed' }
        }

        this.emitProjectToolsUpdated(params.machineId, params.namespace, params.projectPath, 'agent')

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    async listProjectCrons(params: {
        machineId: string
        namespace: string
        projectPath: string
    }): Promise<{ type: 'success'; projectPath: string; crons: ProjectCronConfig[] } | { type: 'error'; message: string }> {
        const result = await this.listProjectTools({
            machineId: params.machineId,
            namespace: params.namespace,
            projectPath: params.projectPath,
            kind: 'cron'
        })
        if (!result.success) {
            return { type: 'error', message: result.error }
        }

        const crons: ProjectCronConfig[] = []
        for (const item of result.items) {
            const parsed = ProjectCronConfigSchema.safeParse(item.config)
            if (parsed.success) {
                crons.push(parsed.data)
            }
        }

        return { type: 'success', projectPath: result.projectPath, crons }
    }

    async startProjectCron(params: {
        machineId: string
        namespace: string
        projectPath: string
        cronRunId: string
        config: ProjectCronConfig
    }): Promise<StartProjectCronResult> {
        const config = params.config
        if (config.enabled === false) {
            return { type: 'error', message: 'Project cron is disabled', code: 'cron_disabled' }
        }

        const agent = config.agent ?? 'claude'
        if (config.permissionMode && !isPermissionModeAllowedForFlavor(config.permissionMode, agent)) {
            return {
                type: 'error',
                message: `Permission mode ${config.permissionMode} is not supported by ${agent}`,
                code: 'invalid_permission_mode'
            }
        }

        const spawnResult = await this.deps.spawnSession(
            params.machineId,
            params.projectPath,
            agent,
            config.model,
            config.modelReasoningEffort,
            undefined,
            undefined,
            undefined,
            undefined,
            config.effort,
            config.permissionMode
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'spawn_failed' }
        }

        const becameActive = await this.deps.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'session_inactive' }
        }

        const metadataUpdated = this.writeSessionCronMetadata(
            spawnResult.sessionId,
            params.namespace,
            {
                cronId: config.id,
                cronRunId: params.cronRunId
            }
        )
        if (!metadataUpdated) {
            return { type: 'error', message: 'Failed to write session cron metadata', code: 'metadata_update_failed' }
        }

        try {
            await this.deps.sendMessage(spawnResult.sessionId, {
                text: config.prompt,
                sentFrom: 'cron'
            })
        } catch (error) {
            return { type: 'error', message: formatError(error, 'Failed to send project cron prompt'), code: 'prompt_send_failed' }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    async archiveCronSession(sessionId: string, timeoutMs?: number): Promise<boolean> {
        if (this.deps.waitForSessionEnd) {
            const ended = await this.deps.waitForSessionEnd(sessionId, timeoutMs)
            if (!ended) {
                await this.deps.archiveSession?.(sessionId)
                return false
            }
            return true
        }
        await this.deps.archiveSession?.(sessionId)
        return true
    }

    listCronRuns(params: {
        namespace: string
        machineId?: string
        projectPath?: string
        cronId?: string
        limit?: number
    }): StoredCronRun[] {
        return this.deps.store.cronRuns?.listRuns(params) ?? []
    }

    private async getAgentConfig(
        machineId: string,
        namespace: string,
        projectPath: string,
        agentId: string
    ): Promise<
        | { type: 'success'; config: ProjectAgentConfig }
        | Extract<StartProjectAgentResult, { type: 'error' }>
    > {
        const result = await this.listProjectTools({
            machineId,
            namespace,
            projectPath,
            kind: 'agent'
        })

        if (!result.success) {
            return { type: 'error', message: result.error, code: 'project_tools_rpc_failed' }
        }

        const item = result.items.find((candidate) => candidate.id === agentId)
        if (!item) {
            return { type: 'error', message: 'Project agent not found', code: 'agent_not_found' }
        }

        const parsed = ProjectAgentConfigSchema.safeParse(item.config)
        if (!parsed.success) {
            return { type: 'error', message: 'Invalid project agent config', code: 'invalid_agent_config' }
        }

        return { type: 'success', config: parsed.data }
    }

    private writeSessionAgentMetadata(
        sessionId: string,
        namespace: string,
        metadataPatch: { agentId: string; agentPrompt: string }
    ): boolean {
        if (this.deps.updateSessionAgentId) {
            return this.deps.updateSessionAgentId(sessionId, namespace, metadataPatch.agentId)
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const stored = this.deps.store.sessions.getSessionByNamespace(sessionId, namespace)
            if (!stored) {
                return false
            }

            if (!stored.metadata || typeof stored.metadata !== 'object' || Array.isArray(stored.metadata)) {
                return false
            }

            const metadata: Record<string, unknown> = { ...stored.metadata }
            metadata.agentId = metadataPatch.agentId
            metadata.agentPrompt = metadataPatch.agentPrompt

            const result = this.deps.store.sessions.updateSessionMetadata(
                sessionId,
                metadata,
                stored.metadataVersion,
                namespace,
                { touchUpdatedAt: false }
            )

            if (result.result === 'success') {
                this.deps.refreshSession(sessionId)
                return true
            }

            if (result.result !== 'version-mismatch') {
                return false
            }
        }

        return false
    }

    private writeSessionCronMetadata(
        sessionId: string,
        namespace: string,
        metadataPatch: { cronId: string; cronRunId: string }
    ): boolean {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const stored = this.deps.store.sessions.getSessionByNamespace(sessionId, namespace)
            if (!stored) {
                return false
            }

            if (!stored.metadata || typeof stored.metadata !== 'object' || Array.isArray(stored.metadata)) {
                return false
            }

            const metadata: Record<string, unknown> = { ...stored.metadata }
            metadata.cronId = metadataPatch.cronId
            metadata.cronRunId = metadataPatch.cronRunId

            const result = this.deps.store.sessions.updateSessionMetadata(
                sessionId,
                metadata,
                stored.metadataVersion,
                namespace,
                { touchUpdatedAt: false }
            )

            if (result.result === 'success') {
                this.deps.refreshSession(sessionId)
                return true
            }

            if (result.result !== 'version-mismatch') {
                return false
            }
        }

        return false
    }

    private registerProject(namespace: string, machineId: string, projectPath: string): void {
        this.deps.store.cronRuns?.registerProject({
            namespace,
            machineId,
            projectPath
        })
    }

    private emitProjectToolsUpdated(
        machineId: string,
        namespace: string,
        projectPath: string,
        kind: ProjectToolKind
    ): void {
        this.deps.emit({
            type: 'project-tools-updated',
            namespace,
            machineId,
            projectPath,
            kind
        })
    }
}

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}
