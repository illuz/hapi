import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type {
    ProjectAgentConfig,
    ProjectCronConfig,
    ProjectToolKind,
    RunProjectCronResponse,
    StartProjectAgentResponse
} from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type ProjectToolTarget = {
    machineId: string
    projectPath: string
}

type UpsertInput = ProjectToolTarget & {
    kind: ProjectToolKind
    config: ProjectAgentConfig | ProjectCronConfig
    expectedHash?: string | null
}

type DeleteInput = ProjectToolTarget & {
    kind: ProjectToolKind
    id: string
    expectedHash?: string | null
}

type StartAgentInput = ProjectToolTarget & {
    agentId: string
}

type RunCronInput = ProjectToolTarget & {
    cronId: string
}

export function useProjectToolsActions(api: ApiClient | null): {
    upsertProjectTool: (input: UpsertInput) => Promise<void>
    deleteProjectTool: (input: DeleteInput) => Promise<void>
    startProjectAgent: (input: StartAgentInput) => Promise<StartProjectAgentResponse>
    runProjectCron: (input: RunCronInput) => Promise<RunProjectCronResponse>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidateProject = async (target: ProjectToolTarget, kind?: ProjectToolKind) => {
        if (kind) {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.projectTools(target.machineId, target.projectPath, kind)
            })
        } else {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: queryKeys.projectTools(target.machineId, target.projectPath, 'agent')
                }),
                queryClient.invalidateQueries({
                    queryKey: queryKeys.projectTools(target.machineId, target.projectPath, 'cron')
                }),
            ])
        }
        await queryClient.invalidateQueries({ queryKey: ['project-tool-counts'] })
        await queryClient.invalidateQueries({
            queryKey: queryKeys.cronRuns(target.machineId, target.projectPath, null)
        })
    }

    const upsertMutation = useMutation({
        mutationFn: async (input: UpsertInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.upsertProjectTool(
                input.machineId,
                input.kind,
                input.projectPath,
                input.config,
                input.expectedHash
            )
            if (!result.success) {
                throw new Error(result.error)
            }
        },
        onSuccess: (_result, input) => {
            void invalidateProject(input, input.kind)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async (input: DeleteInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.deleteProjectTool(
                input.machineId,
                input.kind,
                input.projectPath,
                input.id,
                input.expectedHash
            )
            if (!result.success) {
                throw new Error(result.error)
            }
        },
        onSuccess: (_result, input) => {
            void invalidateProject(input, input.kind)
        },
    })

    const startAgentMutation = useMutation({
        mutationFn: async (input: StartAgentInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.startProjectAgent(input.machineId, input.projectPath, input.agentId)
            if (result.type === 'error') {
                throw new Error(result.message)
            }
            return result
        },
        onSuccess: (_result, input) => {
            void invalidateProject(input, 'agent')
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const runCronMutation = useMutation({
        mutationFn: async (input: RunCronInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.runProjectCron(input.machineId, input.projectPath, input.cronId)
            if (result.type === 'error') {
                throw new Error(result.message)
            }
            return result
        },
        onSuccess: (_result, input) => {
            void invalidateProject(input, 'cron')
            void queryClient.invalidateQueries({
                queryKey: queryKeys.cronRuns(input.machineId, input.projectPath, input.cronId)
            })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    return {
        upsertProjectTool: upsertMutation.mutateAsync,
        deleteProjectTool: deleteMutation.mutateAsync,
        startProjectAgent: startAgentMutation.mutateAsync,
        runProjectCron: runCronMutation.mutateAsync,
        isPending: upsertMutation.isPending
            || deleteMutation.isPending
            || startAgentMutation.isPending
            || runCronMutation.isPending,
    }
}
