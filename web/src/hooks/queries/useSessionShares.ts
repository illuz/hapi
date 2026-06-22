import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionShare } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionShares(api: ApiClient | null, sessionId: string | null): {
    shares: SessionShare[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: sessionId ? queryKeys.sessionShares(sessionId) : ['session-shares', 'none'],
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.getSessionShares(sessionId)
        },
        enabled: Boolean(api && sessionId),
    })

    return {
        shares: query.data?.shares ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load shares' : null,
        refetch: query.refetch,
    }
}
