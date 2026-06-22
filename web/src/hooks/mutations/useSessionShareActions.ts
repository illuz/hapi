import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CreateSessionSharePayload, SessionShare, UpdateSessionSharePayload } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionShareActions(api: ApiClient | null, sessionId: string | null): {
    createShare: (payload: CreateSessionSharePayload) => Promise<SessionShare>
    updateShare: (args: { shareId: string; payload: UpdateSessionSharePayload }) => Promise<SessionShare>
    revokeShare: (shareId: string) => Promise<SessionShare>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidate = async () => {
        if (!sessionId) return
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionShares(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        ])
    }

    const createMutation = useMutation({
        mutationFn: async (payload: CreateSessionSharePayload) => {
            if (!api || !sessionId) throw new Error('Session unavailable')
            const response = await api.createSessionShare(sessionId, payload)
            return response.share
        },
        onSuccess: () => void invalidate()
    })

    const updateMutation = useMutation({
        mutationFn: async (args: { shareId: string; payload: UpdateSessionSharePayload }) => {
            if (!api || !sessionId) throw new Error('Session unavailable')
            const response = await api.updateSessionShare(sessionId, args.shareId, args.payload)
            return response.share
        },
        onSuccess: () => void invalidate()
    })

    const revokeMutation = useMutation({
        mutationFn: async (shareId: string) => {
            if (!api || !sessionId) throw new Error('Session unavailable')
            const response = await api.revokeSessionShare(sessionId, shareId)
            return response.share
        },
        onSuccess: () => void invalidate()
    })

    return {
        createShare: createMutation.mutateAsync,
        updateShare: updateMutation.mutateAsync,
        revokeShare: revokeMutation.mutateAsync,
        isPending: createMutation.isPending || updateMutation.isPending || revokeMutation.isPending
    }
}
