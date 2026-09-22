import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AutoRetrySettingsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useAutoRetrySettings(api: ApiClient | null): {
    enabled: boolean
    isLoading: boolean
    isPending: boolean
    setEnabled: (enabled: boolean) => Promise<AutoRetrySettingsResponse>
} {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.autoRetrySettings,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getAutoRetrySettings()
        },
        enabled: Boolean(api)
    })

    const mutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.setAutoRetryEnabled(enabled)
        },
        onMutate: async (enabled) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.autoRetrySettings })
            const previous = queryClient.getQueryData<AutoRetrySettingsResponse>(queryKeys.autoRetrySettings)
            queryClient.setQueryData<AutoRetrySettingsResponse>(queryKeys.autoRetrySettings, { enabled })
            return { previous }
        },
        onError: (_error, _enabled, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.autoRetrySettings, context.previous)
            }
        },
        onSuccess: (settings) => {
            queryClient.setQueryData(queryKeys.autoRetrySettings, settings)
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.autoRetrySettings })
        }
    })

    return {
        enabled: query.data?.enabled === true,
        isLoading: query.isLoading,
        isPending: mutation.isPending,
        setEnabled: mutation.mutateAsync
    }
}
