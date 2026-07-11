import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { AgentFlavor, CodexCollaborationMode, ForkSessionOptions, PermissionMode, SessionMarkerColor } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow } from '@/lib/message-window-store'
import { clearComposerDraft } from '@/lib/composerDraftStorage'
import { isKnownFlavor } from '@/lib/agentFlavorUtils'

export function useSessionActions(
    api: ApiClient | null,
    sessionId: string | null,
    agentFlavor?: string | null,
    codexCollaborationModeSupported?: boolean
): {
    abortSession: () => Promise<void>
    archiveSession: () => Promise<void>
    forkSession: (options?: number | ForkSessionOptions) => Promise<{ sessionId: string }>
    switchSession: () => Promise<void>
    spawnSessionFromConfig: (agent?: Extract<AgentFlavor, 'claude' | 'codex'>) => Promise<{ sessionId: string }>
    setPermissionMode: (mode: PermissionMode) => Promise<void>
    setCollaborationMode: (mode: CodexCollaborationMode) => Promise<void>
    setModel: (model: string | null) => Promise<void>
    setCodexModelAndReasoningEffort: (args: { model: string; modelReasoningEffort: string | null }) => Promise<void>
    setModelReasoningEffort: (modelReasoningEffort: string | null) => Promise<void>
    setEffort: (effort: string | null) => Promise<void>
    renameSession: (name: string) => Promise<void>
    setSessionMarkerColor: (markerColor: SessionMarkerColor | null) => Promise<void>
    deleteSession: () => Promise<void>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidateSession = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    }

    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.abortSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const archiveMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.archiveSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const forkSessionMutation = useMutation({
        mutationFn: async (options?: number | ForkSessionOptions) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.forkSession(sessionId, options)
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.switchSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const spawnSessionFromConfigMutation = useMutation({
        mutationFn: async (agent?: Extract<AgentFlavor, 'claude' | 'codex'>) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.spawnSessionFromConfig(sessionId, agent)
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const permissionMutation = useMutation({
        mutationFn: async (mode: PermissionMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (isKnownFlavor(agentFlavor) && !isPermissionModeAllowedForFlavor(mode, agentFlavor)) {
                throw new Error('Invalid permission mode for session flavor')
            }
            await api.setPermissionMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const collaborationMutation = useMutation({
        mutationFn: async (mode: CodexCollaborationMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Collaboration mode is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Collaboration mode is only supported for remote Codex sessions')
            }
            await api.setCollaborationMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelMutation = useMutation({
        mutationFn: async (model: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setModel(sessionId, model)
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelReasoningEffortMutation = useMutation({
        mutationFn: async (modelReasoningEffort: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Model reasoning effort is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Model reasoning effort is only supported for remote Codex sessions')
            }
            await api.setModelReasoningEffort(sessionId, modelReasoningEffort)
        },
        onSuccess: () => void invalidateSession(),
    })

    const codexModelAndReasoningEffortMutation = useMutation({
        mutationFn: async (args: { model: string; modelReasoningEffort: string | null }) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Model reasoning effort is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Model reasoning effort is only supported for remote Codex sessions')
            }

            const model = args.model.trim()
            if (!model) {
                throw new Error('Model unavailable')
            }

            await api.setModelReasoningEffort(sessionId, args.modelReasoningEffort, { model })
        },
        onSuccess: () => void invalidateSession(),
    })

    const effortMutation = useMutation({
        mutationFn: async (effort: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setEffort(sessionId, effort)
        },
        onSuccess: () => void invalidateSession(),
    })

    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.renameSession(sessionId, name)
        },
        onSuccess: () => void invalidateSession(),
    })

    const markerColorMutation = useMutation({
        mutationFn: async (markerColor: SessionMarkerColor | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setSessionMarkerColor(sessionId, markerColor)
        },
        onSuccess: () => void invalidateSession(),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.deleteSession(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            clearMessageWindow(sessionId)
            clearComposerDraft(sessionId)
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    return {
        abortSession: abortMutation.mutateAsync,
        archiveSession: archiveMutation.mutateAsync,
        forkSession: forkSessionMutation.mutateAsync,
        switchSession: switchMutation.mutateAsync,
        spawnSessionFromConfig: spawnSessionFromConfigMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setCollaborationMode: collaborationMutation.mutateAsync,
        setModel: modelMutation.mutateAsync,
        setCodexModelAndReasoningEffort: codexModelAndReasoningEffortMutation.mutateAsync,
        setModelReasoningEffort: modelReasoningEffortMutation.mutateAsync,
        setEffort: effortMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        setSessionMarkerColor: markerColorMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        isPending: abortMutation.isPending
            || archiveMutation.isPending
            || forkSessionMutation.isPending
            || switchMutation.isPending
            || spawnSessionFromConfigMutation.isPending
            || permissionMutation.isPending
            || collaborationMutation.isPending
            || modelMutation.isPending
            || codexModelAndReasoningEffortMutation.isPending
            || modelReasoningEffortMutation.isPending
            || effortMutation.isPending
            || renameMutation.isPending
            || markerColorMutation.isPending
            || deleteMutation.isPending,
    }
}
