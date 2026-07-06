import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ProjectPortMappingCreatePayload, ProjectPortMappingMutationResponse, ProjectPortMappingUpdatePayload } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type Target = {
    machineId: string
    projectPath: string
}

export function useProjectPortMappingActions(api: ApiClient | null) {
    const queryClient = useQueryClient()

    const invalidate = async (target?: Target) => {
        if (target) {
            await queryClient.invalidateQueries({ queryKey: queryKeys.projectPortMappings(target.machineId, target.projectPath) })
        } else {
            await queryClient.invalidateQueries({ queryKey: ['project-port-mappings'] })
        }
    }

    const createMutation = useMutation({
        mutationFn: async (input: Target & ProjectPortMappingCreatePayload): Promise<ProjectPortMappingMutationResponse> => {
            if (!api) throw new Error('Not connected')
            const result = await api.createProjectPortMapping(input.machineId, {
                projectPath: input.projectPath,
                alias: input.alias,
                port: input.port,
                durationMs: input.durationMs
            })
            await invalidate(input)
            return result
        }
    })

    const updateMutation = useMutation({
        mutationFn: async (input: Target & { mappingId: string; payload: ProjectPortMappingUpdatePayload }): Promise<ProjectPortMappingMutationResponse> => {
            if (!api) throw new Error('Not connected')
            const result = await api.updateProjectPortMapping(input.mappingId, input.payload)
            await invalidate(input)
            return result
        }
    })

    const enableMutation = useMutation({
        mutationFn: async (input: Target & { mappingId: string; durationMs?: number }): Promise<ProjectPortMappingMutationResponse> => {
            if (!api) throw new Error('Not connected')
            const result = await api.enableProjectPortMapping(input.mappingId, input.durationMs)
            await invalidate(input)
            return result
        }
    })

    const disableMutation = useMutation({
        mutationFn: async (input: Target & { mappingId: string }): Promise<ProjectPortMappingMutationResponse> => {
            if (!api) throw new Error('Not connected')
            const result = await api.disableProjectPortMapping(input.mappingId)
            await invalidate(input)
            return result
        }
    })

    const deleteMutation = useMutation({
        mutationFn: async (input: Target & { mappingId: string }): Promise<ProjectPortMappingMutationResponse> => {
            if (!api) throw new Error('Not connected')
            const result = await api.deleteProjectPortMapping(input.mappingId)
            await invalidate(input)
            return result
        }
    })

    const checkMutation = useMutation({
        mutationFn: async (input: { machineId: string; port: number }) => {
            if (!api) throw new Error('Not connected')
            return await api.checkProjectPortMapping(input.machineId, input.port)
        }
    })

    return {
        createPortMapping: createMutation.mutateAsync,
        updatePortMapping: updateMutation.mutateAsync,
        enablePortMapping: enableMutation.mutateAsync,
        disablePortMapping: disableMutation.mutateAsync,
        deletePortMapping: deleteMutation.mutateAsync,
        checkPortMapping: checkMutation.mutateAsync,
        isPending: createMutation.isPending
            || updateMutation.isPending
            || enableMutation.isPending
            || disableMutation.isPending
            || deleteMutation.isPending
            || checkMutation.isPending
    }
}
