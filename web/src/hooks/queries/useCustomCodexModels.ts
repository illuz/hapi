import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CustomCodexModel } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useCustomCodexModels(args: {
    api: ApiClient | null
    enabled?: boolean
}): {
    models: CustomCodexModel[]
    isLoading: boolean
    error: string | null
} {
    const { api } = args
    const enabled = Boolean(args.enabled !== false && api)
    const query = useQuery({
        queryKey: queryKeys.customCodexModels,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getCustomCodexModels()
        },
        enabled,
        staleTime: 30_000,
        retry: false
    })

    return {
        models: query.data?.models ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error
            ? query.error.message
            : query.error
                ? 'Failed to load custom Codex models'
                : null
    }
}
