import type {
    SessionMarkerColor,
    AttachmentMetadata,
    AuthResponse,
    CodexCollaborationMode,
    DeleteUploadResponse,
    ListDirectoryResponse,
    FileReadResponse,
    FileSearchResponse,
    GitCommandResponse,
    MachineListDirectoryResponse,
    MachinePathsExistsResponse,
    MachinesResponse,
    MessagesResponse,
    ConversationHistoryResponse,
    CodexModelsResponse,
    CronRunsResponse,
    OpencodeModelsResponse,
    PermissionMode,
    ProjectAgentConfig,
    ProjectCronConfig,
    ProjectToolCountsResponse,
    ProjectPortMappingCheckResponse,
    ProjectPortMappingCreatePayload,
    ProjectPortMappingMutationResponse,
    ProjectPortMappingsResponse,
    ProjectPortMappingUpdatePayload,
    ProjectToolKind,
    ProjectToolListResponse,
    ProjectToolMutationResponse,
    PushSubscriptionPayload,
    PushUnsubscribePayload,
    PushVapidPublicKeyResponse,
    RunProjectCronResponse,
    SlashCommandsResponse,
    SkillsResponse,
    SpawnResponse,
    StartProjectAgentResponse,
    UploadFileResponse,
    VisibilityPayload,
    SessionResponse,
    SessionsResponse,
    ForkSessionOptions,
    BulkSessionActionResponse,
    BulkSessionMarkerColorResponse,
    SessionSharesResponse,
    SessionShareResponse,
    CreateSessionSharePayload,
    UpdateSessionSharePayload
} from '@/types/api'
import type { CancelMessageResponse } from '@hapi/protocol/schemas'

type ApiClientOptions = {
    baseUrl?: string
    getToken?: () => string | null
    onUnauthorized?: () => Promise<string | null>
}

type ErrorPayload = {
    error?: unknown
}

function parseErrorCode(bodyText: string): string | undefined {
    try {
        const parsed = JSON.parse(bodyText) as ErrorPayload
        return typeof parsed.error === 'string' ? parsed.error : undefined
    } catch {
        return undefined
    }
}

export class ApiError extends Error {
    status: number
    code?: string
    body?: string

    constructor(message: string, status: number, code?: string, body?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.body = body
    }
}

export class ApiClient {
    private token: string
    private readonly baseUrl: string | null
    private readonly getToken: (() => string | null) | null
    private readonly onUnauthorized: (() => Promise<string | null>) | null

    constructor(token: string, options?: ApiClientOptions) {
        this.token = token
        this.baseUrl = options?.baseUrl ?? null
        this.getToken = options?.getToken ?? null
        this.onUnauthorized = options?.onUnauthorized ?? null
    }

    private buildUrl(path: string): string {
        if (!this.baseUrl) {
            return path
        }
        try {
            return new URL(path, this.baseUrl).toString()
        } catch {
            return path
        }
    }

    private async request<T>(
        path: string,
        init?: RequestInit,
        attempt: number = 0,
        overrideToken?: string | null
    ): Promise<T> {
        const headers = new Headers(init?.headers)
        const liveToken = this.getToken ? this.getToken() : null
        const authToken = overrideToken !== undefined
            ? (overrideToken ?? (liveToken ?? this.token))
            : (liveToken ?? this.token)
        if (authToken) {
            headers.set('authorization', `Bearer ${authToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }

        const res = await fetch(this.buildUrl(path), {
            ...init,
            headers
        })

        if (res.status === 401) {
            if (attempt === 0 && this.onUnauthorized) {
                const refreshed = await this.onUnauthorized()
                if (refreshed) {
                    this.token = refreshed
                    return await this.request<T>(path, init, attempt + 1, refreshed)
                }
            }
            throw new Error('Session expired. Please sign in again.')
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as T
    }

    async authenticate(auth: { initData: string } | { accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/auth'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Auth failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async bind(auth: { initData: string; accessToken: string }): Promise<AuthResponse> {
        const res = await fetch(this.buildUrl('/api/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(auth)
        })

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            const code = parseErrorCode(body)
            const detail = body ? `: ${body}` : ''
            throw new ApiError(`Bind failed: HTTP ${res.status} ${res.statusText}${detail}`, res.status, code, body || undefined)
        }

        return await res.json() as AuthResponse
    }

    async getSessions(): Promise<SessionsResponse> {
        return await this.request<SessionsResponse>('/api/sessions')
    }

    async getPushVapidPublicKey(): Promise<PushVapidPublicKeyResponse> {
        return await this.request<PushVapidPublicKeyResponse>('/api/push/vapid-public-key')
    }

    async subscribePushNotifications(payload: PushSubscriptionPayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async unsubscribePushNotifications(payload: PushUnsubscribePayload): Promise<void> {
        await this.request('/api/push/subscribe', {
            method: 'DELETE',
            body: JSON.stringify(payload)
        })
    }

    async setVisibility(payload: VisibilityPayload): Promise<void> {
        await this.request('/api/visibility', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async getSession(sessionId: string): Promise<SessionResponse> {
        return await this.request<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`)
    }

    async getSessionShares(sessionId: string): Promise<SessionSharesResponse> {
        return await this.request<SessionSharesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/shares`)
    }

    async createSessionShare(sessionId: string, payload: CreateSessionSharePayload): Promise<SessionShareResponse> {
        return await this.request<SessionShareResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/shares`, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
    }

    async updateSessionShare(sessionId: string, shareId: string, payload: UpdateSessionSharePayload): Promise<SessionShareResponse> {
        return await this.request<SessionShareResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/shares/${encodeURIComponent(shareId)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        })
    }

    async revokeSessionShare(sessionId: string, shareId: string): Promise<SessionShareResponse> {
        return await this.request<SessionShareResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/shares/${encodeURIComponent(shareId)}/revoke`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async getConversationHistory(options: {
        scope: 'session' | 'project' | 'all'
        sessionId?: string | null
        projectPath?: string | null
        query?: string | null
        userOnly?: boolean
        limit?: number
        beforeCreatedAt?: number | null
        beforeId?: string | null
    }): Promise<ConversationHistoryResponse> {
        const params = new URLSearchParams()
        params.set('scope', options.scope)
        if (options.sessionId) params.set('sessionId', options.sessionId)
        if (options.projectPath) params.set('projectPath', options.projectPath)
        if (options.query) params.set('q', options.query)
        if (options.userOnly) params.set('userOnly', 'true')
        if (options.limit !== undefined) params.set('limit', `${options.limit}`)
        if (options.beforeCreatedAt !== undefined && options.beforeCreatedAt !== null) {
            params.set('beforeCreatedAt', `${options.beforeCreatedAt}`)
        }
        if (options.beforeId) params.set('beforeId', options.beforeId)
        return await this.request<ConversationHistoryResponse>(`/api/history?${params.toString()}`)
    }

    async getMessages(
        sessionId: string,
        options: {
            beforeSeq?: number | null
            beforeAt?: number | null
            byPosition?: boolean
            limit?: number
        }
    ): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.byPosition || options.beforeAt !== undefined && options.beforeAt !== null) {
            params.set('byPosition', '1')
        }
        if (options.beforeAt !== undefined && options.beforeAt !== null) {
            params.set('beforeAt', `${options.beforeAt}`)
        }
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined && options.limit !== null) {
            params.set('limit', `${options.limit}`)
        }

        const qs = params.toString()
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
        return await this.request<MessagesResponse>(url)
    }

    async getGitStatus(sessionId: string): Promise<GitCommandResponse> {
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-status`)
    }

    async getGitDiffNumstat(sessionId: string, staged: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('staged', staged ? 'true' : 'false')
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-numstat?${params.toString()}`)
    }

    async getGitDiffFile(sessionId: string, path: string, staged?: boolean): Promise<GitCommandResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        if (staged !== undefined) {
            params.set('staged', staged ? 'true' : 'false')
        }
        return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-diff-file?${params.toString()}`)
    }

    async searchSessionFiles(sessionId: string, query: string, limit?: number): Promise<FileSearchResponse> {
        const params = new URLSearchParams()
        if (query) {
            params.set('query', query)
        }
        if (limit !== undefined) {
            params.set('limit', `${limit}`)
        }
        const qs = params.toString()
        return await this.request<FileSearchResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/files${qs ? `?${qs}` : ''}`)
    }

    async readSessionFile(sessionId: string, path: string): Promise<FileReadResponse> {
        const params = new URLSearchParams()
        params.set('path', path)
        return await this.request<FileReadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/file?${params.toString()}`)
    }

    async listSessionDirectory(sessionId: string, path?: string): Promise<ListDirectoryResponse> {
        const params = new URLSearchParams()
        if (path) {
            params.set('path', path)
        }

        const qs = params.toString()
        return await this.request<ListDirectoryResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/directory${qs ? `?${qs}` : ''}`
        )
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<UploadFileResponse> {
        return await this.request<UploadFileResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload`, {
            method: 'POST',
            body: JSON.stringify({ filename, content, mimeType })
        })
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<DeleteUploadResponse> {
        return await this.request<DeleteUploadResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/upload/delete`, {
            method: 'POST',
            body: JSON.stringify({ path })
        })
    }

    async resumeSession(sessionId: string, opts?: { permissionMode?: string }): Promise<string> {
        const response = await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
            {
                method: 'POST',
                ...(opts?.permissionMode !== undefined && {
                    body: JSON.stringify({ permissionMode: opts.permissionMode })
                })
            }
        )
        return response.sessionId
    }

    async spawnSessionFromConfig(sessionId: string, agent?: 'claude' | 'codex'): Promise<{ sessionId: string }> {
        return await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/spawn-from-config`,
            {
                method: 'POST',
                body: JSON.stringify(agent ? { agent } : {})
            }
        )
    }

    async forkSession(sessionId: string, options?: number | ForkSessionOptions): Promise<{ sessionId: string }> {
        const body = typeof options === 'number'
            ? { rollbackTurns: options }
            : options
                ? {
                    ...(options.rollbackTurns !== undefined ? { rollbackTurns: options.rollbackTurns } : {}),
                    ...(options.resumeSessionAt ? { resumeSessionAt: options.resumeSessionAt } : {})
                }
                : {}

        return await this.request<{ sessionId: string }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
            {
                method: 'POST',
                body: JSON.stringify(body)
            }
        )
    }

    async sendMessage(sessionId: string, text: string, localId?: string | null, attachments?: AttachmentMetadata[]): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                localId: localId ?? undefined,
                attachments: attachments ?? undefined
            })
        })
    }

    async cancelMessage(sessionId: string, messageId: string): Promise<CancelMessageResponse> {
        const response = await this.request(
            `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
            { method: 'DELETE' }
        )
        return response as CancelMessageResponse
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async archiveSessions(sessionIds: string[]): Promise<BulkSessionActionResponse> {
        return await this.request<BulkSessionActionResponse>('/api/sessions/bulk/archive', {
            method: 'POST',
            body: JSON.stringify({ sessionIds })
        })
    }

    async setSessionsMarkerColor(sessionIds: string[], markerColor: SessionMarkerColor | null): Promise<BulkSessionMarkerColorResponse> {
        return await this.request<BulkSessionMarkerColorResponse>('/api/sessions/bulk/marker-color', {
            method: 'POST',
            body: JSON.stringify({ sessionIds, markerColor })
        })
    }

    async switchSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, {
            method: 'POST',
            body: JSON.stringify({})
        })
    }

    async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permission-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setCollaborationMode(sessionId: string, mode: CodexCollaborationMode): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/collaboration-mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        })
    }

    async setModel(sessionId: string, model: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
            method: 'POST',
            body: JSON.stringify({ model })
        })
    }

    async setModelReasoningEffort(
        sessionId: string,
        modelReasoningEffort: string | null,
        options?: { model?: string | null }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model-reasoning-effort`, {
            method: 'POST',
            body: JSON.stringify({
                modelReasoningEffort,
                ...(options?.model !== undefined ? { model: options.model } : {})
            })
        })
    }

    async setEffort(sessionId: string, effort: string | null): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/effort`, {
            method: 'POST',
            body: JSON.stringify({ effort })
        })
    }

    async setAutoContinueSettings(sessionId: string, settings: {
        enabled: boolean
        remaining: number
        maxRuns: number
        keywords: string[]
        messageText: string
    }): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/auto-continue`, {
            method: 'POST',
            body: JSON.stringify(settings)
        })
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }
    ): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        })
    }

    async getMachines(): Promise<MachinesResponse> {
        return await this.request<MachinesResponse>('/api/machines')
    }


    async getProjectPortMappings(
        machineId: string,
        projectPath: string
    ): Promise<ProjectPortMappingsResponse> {
        const params = new URLSearchParams()
        params.set('projectPath', projectPath)
        return await this.request<ProjectPortMappingsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/port-mappings?${params.toString()}`
        )
    }

    async createProjectPortMapping(
        machineId: string,
        payload: ProjectPortMappingCreatePayload
    ): Promise<ProjectPortMappingMutationResponse> {
        return await this.request<ProjectPortMappingMutationResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/port-mappings`,
            {
                method: 'POST',
                body: JSON.stringify(payload)
            }
        )
    }

    async updateProjectPortMapping(
        mappingId: string,
        payload: ProjectPortMappingUpdatePayload
    ): Promise<ProjectPortMappingMutationResponse> {
        return await this.request<ProjectPortMappingMutationResponse>(
            `/api/port-mappings/${encodeURIComponent(mappingId)}`,
            {
                method: 'PATCH',
                body: JSON.stringify(payload)
            }
        )
    }

    async enableProjectPortMapping(
        mappingId: string,
        durationMs?: number
    ): Promise<ProjectPortMappingMutationResponse> {
        return await this.request<ProjectPortMappingMutationResponse>(
            `/api/port-mappings/${encodeURIComponent(mappingId)}/enable`,
            {
                method: 'POST',
                body: JSON.stringify(durationMs ? { durationMs } : {})
            }
        )
    }

    async disableProjectPortMapping(mappingId: string): Promise<ProjectPortMappingMutationResponse> {
        return await this.request<ProjectPortMappingMutationResponse>(
            `/api/port-mappings/${encodeURIComponent(mappingId)}/disable`,
            { method: 'POST' }
        )
    }

    async deleteProjectPortMapping(mappingId: string): Promise<ProjectPortMappingMutationResponse> {
        return await this.request<ProjectPortMappingMutationResponse>(
            `/api/port-mappings/${encodeURIComponent(mappingId)}`,
            { method: 'DELETE' }
        )
    }

    async checkProjectPortMapping(
        machineId: string,
        port: number
    ): Promise<ProjectPortMappingCheckResponse> {
        return await this.request<ProjectPortMappingCheckResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/port-mappings/check`,
            {
                method: 'POST',
                body: JSON.stringify({ port, targetHost: '127.0.0.1' })
            }
        )
    }

    async getProjectTools<K extends ProjectToolKind>(
        machineId: string,
        projectPath: string,
        kind: K
    ): Promise<ProjectToolListResponse<K>> {
        const params = new URLSearchParams()
        params.set('projectPath', projectPath)
        return await this.request<ProjectToolListResponse<K>>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/${encodeURIComponent(kind)}?${params.toString()}`
        )
    }

    async getProjectToolCounts(projects: Array<{ machineId: string; projectPath: string }>): Promise<ProjectToolCountsResponse> {
        return await this.request<ProjectToolCountsResponse>('/api/project-tools/counts', {
            method: 'POST',
            body: JSON.stringify({ projects })
        })
    }

    async upsertProjectTool(
        machineId: string,
        kind: ProjectToolKind,
        projectPath: string,
        config: ProjectAgentConfig | ProjectCronConfig,
        expectedHash?: string | null
    ): Promise<ProjectToolMutationResponse> {
        return await this.request<ProjectToolMutationResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/${encodeURIComponent(kind)}`,
            {
                method: 'POST',
                body: JSON.stringify({ projectPath, config, expectedHash })
            }
        )
    }

    async deleteProjectTool(
        machineId: string,
        kind: ProjectToolKind,
        projectPath: string,
        toolId: string,
        expectedHash?: string | null
    ): Promise<ProjectToolMutationResponse> {
        const params = new URLSearchParams()
        params.set('projectPath', projectPath)
        if (expectedHash) {
            params.set('expectedHash', expectedHash)
        }
        return await this.request<ProjectToolMutationResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/${encodeURIComponent(kind)}/${encodeURIComponent(toolId)}?${params.toString()}`,
            { method: 'DELETE' }
        )
    }

    async startProjectAgent(
        machineId: string,
        projectPath: string,
        agentId: string
    ): Promise<StartProjectAgentResponse> {
        return await this.request<StartProjectAgentResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/agents/${encodeURIComponent(agentId)}/start`,
            {
                method: 'POST',
                body: JSON.stringify({ projectPath })
            }
        )
    }

    async getCronRuns(
        machineId: string,
        options: { projectPath?: string; cronId?: string; limit?: number } = {}
    ): Promise<CronRunsResponse> {
        const params = new URLSearchParams()
        if (options.projectPath) {
            params.set('projectPath', options.projectPath)
        }
        if (options.cronId) {
            params.set('cronId', options.cronId)
        }
        if (options.limit !== undefined) {
            params.set('limit', String(options.limit))
        }
        const query = params.toString()
        return await this.request<CronRunsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/cron-runs${query ? `?${query}` : ''}`
        )
    }

    async runProjectCron(
        machineId: string,
        projectPath: string,
        cronId: string
    ): Promise<RunProjectCronResponse> {
        return await this.request<RunProjectCronResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/project-tools/cron/${encodeURIComponent(cronId)}/run`,
            {
                method: 'POST',
                body: JSON.stringify({ projectPath })
            }
        )
    }

    async listMachineDirectory(
        machineId: string,
        path: string
    ): Promise<MachineListDirectoryResponse> {
        return await this.request<MachineListDirectoryResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/list-directory`,
            {
                method: 'POST',
                body: JSON.stringify({ path })
            }
        )
    }

    async checkMachinePathsExists(
        machineId: string,
        paths: string[]
    ): Promise<MachinePathsExistsResponse> {
        return await this.request<MachinePathsExistsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/paths/exists`,
            {
                method: 'POST',
                body: JSON.stringify({ paths })
            }
        )
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
        model?: string,
        modelReasoningEffort?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        effort?: string
    ): Promise<SpawnResponse> {
        return await this.request<SpawnResponse>(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
            method: 'POST',
            body: JSON.stringify({ directory, agent, model, modelReasoningEffort, yolo, sessionType, worktreeName, effort })
        })
    }

    async getMachineCodexModels(machineId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/codex-models`
        )
    }

    async getSessionCodexModels(sessionId: string): Promise<CodexModelsResponse> {
        return await this.request<CodexModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/codex-models`
        )
    }

    async getSessionOpencodeModels(sessionId: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/opencode-models`
        )
    }

    async getMachineOpencodeModelsForCwd(machineId: string, cwd: string): Promise<OpencodeModelsResponse> {
        return await this.request<OpencodeModelsResponse>(
            `/api/machines/${encodeURIComponent(machineId)}/opencode-models?cwd=${encodeURIComponent(cwd)}`
        )
    }

    async getSlashCommands(sessionId: string): Promise<SlashCommandsResponse> {
        return await this.request<SlashCommandsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/slash-commands`
        )
    }

    async getSkills(sessionId: string): Promise<SkillsResponse> {
        return await this.request<SkillsResponse>(
            `/api/sessions/${encodeURIComponent(sessionId)}/skills`
        )
    }

    async updateSession(sessionId: string, updates: { name?: string; markerColor?: SessionMarkerColor | null; pinned?: boolean }): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.updateSession(sessionId, { name })
    }

    async setSessionMarkerColor(sessionId: string, markerColor: SessionMarkerColor | null): Promise<void> {
        await this.updateSession(sessionId, { markerColor })
    }

    async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
        await this.updateSession(sessionId, { pinned })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
    }

    async deleteSessions(sessionIds: string[]): Promise<BulkSessionActionResponse> {
        return await this.request<BulkSessionActionResponse>('/api/sessions/bulk/delete', {
            method: 'POST',
            body: JSON.stringify({ sessionIds })
        })
    }

    async fetchVoiceToken(options?: { customAgentId?: string; customApiKey?: string }): Promise<{
        allowed: boolean
        token?: string
        agentId?: string
        error?: string
    }> {
        return await this.request('/api/voice/token', {
            method: 'POST',
            body: JSON.stringify(options || {})
        })
    }
}
