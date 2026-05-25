import { describe, expect, it } from 'bun:test'
import { ProjectToolsService } from './projectToolsService'

function createService(overrides?: {
    listResult?: unknown
    spawnResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string }
    waitActive?: boolean
    updateSessionAgentId?: (sessionId: string, namespace: string, agentId: string) => boolean
}) {
    let metadataValue: unknown = { path: '/repo', host: 'test-host' }
    let metadataVersion = 1
    const calls: {
        spawn: unknown[]
        wait: unknown[]
        messages: unknown[]
        events: unknown[]
        metadataUpdates: unknown[]
    } = {
        spawn: [],
        wait: [],
        messages: [],
        events: [],
        metadataUpdates: []
    }

    const service = new ProjectToolsService({
        store: {
            sessions: {
                getSessionByNamespace: () => ({
                    metadata: metadataValue,
                    metadataVersion
                }),
                updateSessionMetadata: (...args) => {
                    calls.metadataUpdates.push(args)
                    metadataValue = args[1]
                    metadataVersion += 1
                    return { result: 'success' }
                }
            }
        },
        rpcGateway: {
            listProjectTools: async () => overrides?.listResult ?? {
                success: true,
                kind: 'agent',
                projectPath: '/repo',
                items: [{
                    kind: 'agent',
                    id: 'reviewer',
                    path: '/repo/.hapi/agents/reviewer.json',
                    config: {
                        id: 'reviewer',
                        prompt: 'Review this project',
                        agent: 'codex',
                        model: 'gpt-5.4',
                        modelReasoningEffort: 'high',
                        effort: 'xhigh',
                        permissionMode: 'safe-yolo'
                    }
                }]
            }
        } as never,
        emit: (event) => {
            calls.events.push(event)
        },
        spawnSession: async (...args) => {
            calls.spawn.push(args)
            return overrides?.spawnResult ?? { type: 'success', sessionId: 'session-1' }
        },
        waitForSessionActive: async (...args) => {
            calls.wait.push(args)
            return overrides?.waitActive ?? true
        },
        sendMessage: async (...args) => {
            calls.messages.push(args)
        },
        getSession: () => undefined,
        refreshSession: () => null,
        ...(overrides?.updateSessionAgentId ? { updateSessionAgentId: overrides.updateSessionAgentId } : {})
    })

    return { service, calls }
}

describe('ProjectToolsService', () => {
    it('starts a project agent by spawning, waiting active, writing metadata, and not sending prompt', async () => {
        const { service, calls } = createService()

        const result = await service.startProjectAgent({
            machineId: 'machine-1',
            namespace: 'default',
            projectPath: '/repo',
            agentId: 'reviewer'
        })

        expect(result).toEqual({ type: 'success', sessionId: 'session-1' })
        expect(calls.spawn[0]).toEqual([
            'machine-1',
            '/repo',
            'codex',
            'gpt-5.4',
            'high',
            undefined,
            undefined,
            undefined,
            undefined,
            'xhigh',
            'safe-yolo'
        ])
        expect(calls.wait).toEqual([['session-1', undefined]])
        expect(calls.metadataUpdates).toEqual([[
            'session-1',
            {
                path: '/repo',
                host: 'test-host',
                agentId: 'reviewer',
                agentPrompt: 'Review this project'
            },
            1,
            'default',
            { touchUpdatedAt: false }
        ]])
        expect(calls.messages).toEqual([])
        expect(calls.events).toEqual([{
            type: 'project-tools-updated',
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            kind: 'agent'
        }])
    })

    it('rejects permission modes unsupported by the configured agent flavor before spawning', async () => {
        const { service, calls } = createService({
            listResult: {
                success: true,
                kind: 'agent',
                projectPath: '/repo',
                items: [{
                    kind: 'agent',
                    id: 'unsafe',
                    path: '/repo/.hapi/agents/unsafe.json',
                    config: {
                        id: 'unsafe',
                        prompt: 'Do work',
                        agent: 'opencode',
                        permissionMode: 'safe-yolo'
                    }
                }]
            }
        })

        const result = await service.startProjectAgent({
            machineId: 'machine-1',
            namespace: 'default',
            projectPath: '/repo',
            agentId: 'unsafe'
        })

        expect(result).toEqual({
            type: 'error',
            message: 'Permission mode safe-yolo is not supported by opencode',
            code: 'invalid_permission_mode'
        })
        expect(calls.spawn).toEqual([])
    })

    it('returns metadata_update_failed when agentId cannot be written', async () => {
        const { service, calls } = createService({
            updateSessionAgentId: () => false
        })

        const result = await service.startProjectAgent({
            machineId: 'machine-1',
            namespace: 'default',
            projectPath: '/repo',
            agentId: 'reviewer'
        })

        expect(result).toEqual({
            type: 'error',
            message: 'Failed to write session agent metadata',
            code: 'metadata_update_failed'
        })
        expect(calls.messages).toEqual([])
    })
})
