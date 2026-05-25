import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type {
    CronRunsResponse,
    ProjectToolCounts,
    ProjectToolCountsResponse,
    ProjectToolKind,
    ProjectToolListResponse
} from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export type ProjectToolTarget = {
    machineId: string
    projectPath: string
}

export type ProjectToolCountsByKey = Record<string, ProjectToolCounts>

export function getProjectToolTargetKey(target: ProjectToolTarget): string {
    return `${target.machineId}::${target.projectPath}`
}

function buildProjectsKey(projects: ProjectToolTarget[]): string {
    return projects
        .map((project) => `${project.machineId}\u0000${project.projectPath}`)
        .sort()
        .join('\u0001')
}

function deduplicateProjects(projects: ProjectToolTarget[]): ProjectToolTarget[] {
    const seen = new Set<string>()
    const result: ProjectToolTarget[] = []
    for (const project of projects) {
        if (!project.machineId || !project.projectPath) {
            continue
        }
        const key = getProjectToolTargetKey(project)
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        result.push(project)
    }
    return result
}

export function useProjectToolCounts(
    api: ApiClient | null,
    projects: ProjectToolTarget[]
): {
    countsByKey: ProjectToolCountsByKey
    isLoading: boolean
    error: string | null
} {
    const normalizedProjects = useMemo(
        () => deduplicateProjects(projects),
        [projects]
    )
    const projectsKey = useMemo(
        () => buildProjectsKey(normalizedProjects),
        [normalizedProjects]
    )

    const query = useQuery<ProjectToolCountsResponse>({
        queryKey: queryKeys.projectToolCounts(projectsKey),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getProjectToolCounts(normalizedProjects)
        },
        enabled: Boolean(api && normalizedProjects.length > 0),
        staleTime: 15_000,
    })

    const countsByKey = useMemo<ProjectToolCountsByKey>(() => {
        const result: ProjectToolCountsByKey = {}
        for (const item of query.data?.counts ?? []) {
            result[getProjectToolTargetKey(item)] = item.counts
        }
        return result
    }, [query.data])

    return {
        countsByKey,
        isLoading: query.isLoading,
        error: query.error instanceof Error
            ? query.error.message
            : query.error
                ? 'Failed to load project tools counts'
                : null,
    }
}

export function useProjectTools<K extends ProjectToolKind>(
    api: ApiClient | null,
    target: ProjectToolTarget | null,
    kind: K,
    options?: { enabled?: boolean }
): {
    data: ProjectToolListResponse<K> | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery<ProjectToolListResponse<K>>({
        queryKey: target
            ? queryKeys.projectTools(target.machineId, target.projectPath, kind)
            : queryKeys.projectTools('unknown', 'unknown', kind),
        queryFn: async () => {
            if (!api || !target) {
                throw new Error('Project unavailable')
            }
            return await api.getProjectTools(target.machineId, target.projectPath, kind)
        },
        enabled: Boolean(api && target && (options?.enabled ?? true)),
    })

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? query.data.error
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load project tools'
                    : null,
        refetch: query.refetch,
    }
}

export function useCronRuns(
    api: ApiClient | null,
    target: ProjectToolTarget | null,
    options?: { cronId?: string | null; limit?: number; enabled?: boolean }
): {
    runs: CronRunsResponse['runs']
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery<CronRunsResponse>({
        queryKey: target
            ? queryKeys.cronRuns(target.machineId, target.projectPath, options?.cronId)
            : queryKeys.cronRuns('unknown', 'unknown', options?.cronId),
        queryFn: async () => {
            if (!api || !target) {
                throw new Error('Project unavailable')
            }
            return await api.getCronRuns(target.machineId, {
                projectPath: target.projectPath,
                cronId: options?.cronId ?? undefined,
                limit: options?.limit,
            })
        },
        enabled: Boolean(api && target && (options?.enabled ?? true)),
    })

    return {
        runs: query.data?.runs ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error
            ? query.error.message
            : query.error
                ? 'Failed to load cron runs'
                : null,
        refetch: query.refetch,
    }
}
