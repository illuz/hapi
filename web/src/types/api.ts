import type {
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    SessionMarkerColor,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@hapi/protocol/types'
import type {
    CronRunStatus,
    ProjectAgentConfig,
    ProjectCronConfig,
    ProjectToolCounts,
    ProjectToolCountsResult,
    ProjectToolKind
} from '@hapi/protocol/projectTools'
import type {
    PortMapping,
    PortMappingCreateRequest,
    PortMappingListResponse,
    PortMappingMutationResponse,
    PortMappingUpdateRequest,
    PortProxyCheckResponse
} from '@hapi/protocol/portMappings'

export type {
    AgentFlavor,
    AgentState,
    AttachmentMetadata,
    CodexCollaborationMode,
    SessionMarkerColor,
    PermissionMode,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    TeamMember,
    TeamMessage,
    TeamState,
    TeamTask,
    TodoItem,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type {
    CronRunStatus,
    ProjectAgentConfig,
    ProjectCronConfig,
    ProjectCronSchedule,
    ProjectToolAgent,
    ProjectToolCounts,
    ProjectToolCountsResult,
    ProjectToolKind
} from '@hapi/protocol/projectTools'

export type {
    PortMapping,
    PortMappingCreateRequest,
    PortMappingListResponse,
    PortMappingMutationResponse,
    PortMappingStaticPath,
    PortMappingStatus,
    PortMappingTargetType,
    PortMappingUpdateRequest,
    PortProxyCheckResponse
} from '@hapi/protocol/portMappings'

export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
    invokedAt?: number | null
}

export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        workspaceRoots?: string[]
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type ForkSessionOptions = {
    rollbackTurns?: number
    resumeSessionAt?: string
}
export type BulkSessionActionResponse = {
    successIds: string[]
    skipped: Array<{
        sessionId: string
        reason: 'session_inactive' | 'session_active'
    }>
    failed: Array<{
        sessionId: string
        error: string
    }>
}

export type BulkSessionMarkerColorResponse = {
    successIds: string[]
    failed: Array<{
        sessionId: string
        error: string
    }>
}
export type SessionShareStatus = 'active' | 'expired' | 'revoked'

export type SessionShare = {
    id: string
    sessionId: string
    label: string | null
    url?: string
    expiresAt: number | null
    revokedAt: number | null
    createdAt: number
    updatedAt: number
    lastUsedAt: number | null
    visibleFromSeq: number
    status: SessionShareStatus
}

export type SessionSharesResponse = { shares: SessionShare[] }
export type SessionShareResponse = { share: SessionShare }

export type CreateSessionSharePayload = {
    password: string
    label?: string | null
    expiresAt?: number | null
    includeHistory?: boolean
}

export type UpdateSessionSharePayload = {
    password?: string
    label?: string | null
    expiresAt?: number | null
}
export type ConversationHistoryEntry = {
    id: string
    namespace: string
    sessionId: string
    userMessageId: string | null
    assistantMessageId: string | null
    createdAt: number
    title: string
    projectPath: string | null
    projectHost: string | null
    markerColor: SessionMarkerColor | null
    userText: string
    assistantExcerpt: string
}

export type ConversationHistoryResponse = {
    entries: ConversationHistoryEntry[]
    page: {
        limit: number
        nextBeforeCreatedAt: number | null
        nextBeforeId: string | null
        hasMore: boolean
    }
}

export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq?: number | null
        nextBeforeSeq: number | null
        nextBeforeAt?: number | null
        hasMore: boolean
    }
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

export type MachineDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
    isGitRepo?: boolean
}

export type MachineListDirectoryResponse = {
    success: boolean
    entries?: MachineDirectoryEntry[]
    error?: string
}

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type ProjectToolFileError = {
    path: string
    id?: string
    error: string
}

export type ProjectAgentToolItem = {
    kind: 'agent'
    id: string
    path: string
    config: ProjectAgentConfig
    value?: ProjectAgentConfig
    hash?: string
    updatedAt?: number
}

export type ProjectCronToolItem = {
    kind: 'cron'
    id: string
    path: string
    config: ProjectCronConfig
    value?: ProjectCronConfig
    hash?: string
    updatedAt?: number
}

export type ProjectToolItem = ProjectAgentToolItem | ProjectCronToolItem

export type ProjectToolListResponse<K extends ProjectToolKind = ProjectToolKind> =
    | {
        success: true
        kind: K
        projectPath: string
        items: K extends 'agent' ? ProjectAgentToolItem[] : ProjectCronToolItem[]
        errors?: ProjectToolFileError[]
    }
    | {
        success: false
        error: string
    }

export type ProjectToolCountsResponse = {
    counts: ProjectToolCountsResult[]
    errors?: Array<{ machineId?: string; projectPath?: string; error: string }>
}

export type ProjectToolMutationResponse =
    | {
        success: true
        kind: ProjectToolKind
        projectPath: string
        id: string
        item?: ProjectToolItem
        hash?: string
    }
    | {
        success: false
        error: string
    }

export type StartProjectAgentResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code?: string }

export type RunProjectCronResponse =
    | { type: 'success'; cronRunId: string; sessionId?: string | null }
    | { type: 'error'; message: string; code?: string }

export type ProjectCronRun = {
    id: string
    namespace?: string
    machineId: string
    projectPath: string
    cronId: string
    sessionId: string | null
    status: CronRunStatus
    scheduledAt: number
    queuedAt: number
    startedAt: number | null
    finishedAt: number | null
    error: string | null
    createdAt: number
    updatedAt: number
}

export type CronRunsResponse = {
    runs: ProjectCronRun[]
}

export type ProjectPortMappingsResponse = PortMappingListResponse
export type ProjectPortMappingMutationResponse = PortMappingMutationResponse
export type ProjectPortMappingCheckResponse = PortProxyCheckResponse
export type ProjectPortMappingCreatePayload = PortMappingCreateRequest
export type ProjectPortMappingUpdatePayload = PortMappingUpdateRequest

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}

export type CodexModelSummary = {
    id: string
    displayName: string
    isDefault: boolean
    defaultReasoningEffort?: string | null
    supportedReasoningEfforts?: string[]
}

export type CodexModelsResponse = {
    success: boolean
    models?: CodexModelSummary[]
    error?: string
}

export type OpencodeModelSummary = {
    modelId: string
    name?: string
}

export type OpencodeModelsResponse = {
    success: boolean
    availableModels?: OpencodeModelSummary[]
    currentModelId?: string | null
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent
