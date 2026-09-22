import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ConversationOutlineEntry } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useConversationOutline(options: {
    api: ApiClient | null
    sessionId: string | null
    enabled: boolean
}): {
    entries: ConversationOutlineEntry[] | null
    isLoading: boolean
    error: string | null
} {
    const resolvedSessionId = options.sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.conversationOutline(resolvedSessionId),
        queryFn: async () => {
            if (!options.api || !options.sessionId) {
                throw new Error('Session unavailable')
            }
            return await options.api.getConversationOutline(options.sessionId)
        },
        enabled: options.enabled && Boolean(options.api && options.sessionId),
        staleTime: 0,
        retry: false
    })

    return {
        entries: query.data?.items ?? null,
        isLoading: query.isLoading || query.isFetching,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load outline' : null
    }
}
