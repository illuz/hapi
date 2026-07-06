import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { PortMapping, ProjectPortMappingsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export type ProjectPortMappingTarget = {
    machineId: string
    projectPath: string
}

export function useProjectPortMappings(
    api: ApiClient | null,
    target: ProjectPortMappingTarget | null
): {
    mappings: PortMapping[]
    data: ProjectPortMappingsResponse | null
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const query = useQuery<ProjectPortMappingsResponse>({
        queryKey: target ? queryKeys.projectPortMappings(target.machineId, target.projectPath) : ['project-port-mappings', 'disabled'],
        queryFn: async () => {
            if (!api || !target) {
                throw new Error('Project unavailable')
            }
            return await api.getProjectPortMappings(target.machineId, target.projectPath)
        },
        enabled: Boolean(api && target),
        staleTime: 10_000
    })

    const mappings = useMemo(() => query.data?.mappings ?? [], [query.data])

    return {
        mappings,
        data: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refetch: () => { void query.refetch() }
    }
}
