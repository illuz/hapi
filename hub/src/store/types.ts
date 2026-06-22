import type { PermissionMode, SessionMarkerColor } from '@hapi/protocol/types'
import type { CronRunStatus } from '@hapi/protocol/projectTools'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    model: string | null
    modelReasoningEffort: string | null
    serviceTier: string | null
    effort: string | null
    permissionMode: PermissionMode | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    markerColor: SessionMarkerColor | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
    invokedAt: number | null
}

export type StoredSessionShare = {
    id: string
    namespace: string
    sessionId: string
    tokenHash: string
    tokenEncrypted: string
    passwordHash: string
    label: string | null
    visibleFromSeq: number
    expiresAt: number | null
    revokedAt: number | null
    createdAt: number
    updatedAt: number
    lastUsedAt: number | null
}

export type StoredHistoryEntry = {
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

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type StoredCronProject = {
    namespace: string
    machineId: string
    projectPath: string
    enabled: boolean
    lastSeenAt: number
    lastLoadedAt: number | null
    createdAt: number
    updatedAt: number
}

export type StoredCronRun = {
    id: string
    namespace: string
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

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
