import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ioMock = vi.hoisted(() => vi.fn())
const listOpencodeModelsForCwdMock = vi.hoisted(() => vi.fn())

vi.mock('socket.io-client', () => ({
    io: ioMock
}))

vi.mock('@/api/auth', () => ({
    getAuthToken: () => 'cli-token'
}))

vi.mock('../modules/common/opencodeModels', () => ({
    listOpencodeModelsForCwd: listOpencodeModelsForCwdMock
}))

import { ApiMachineClient } from './apiMachine'
import type { Machine } from './types'

function makeMachine(id: string): Machine {
    return {
        id,
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: null,
        metadataVersion: 0,
        runnerState: null,
        runnerStateVersion: 0
    }
}

async function callListOpencodeModels(client: ApiMachineClient, machineId: string, cwd: string): Promise<unknown> {
    // Reach into the private rpc handler manager to dispatch a request.
    // Mirrors how the on-socket 'rpc-request' listener invokes handleRequest.
    const manager = (client as unknown as { rpcHandlerManager: { handleRequest: (req: { method: string; params: string }) => Promise<string> } }).rpcHandlerManager
    const raw = await manager.handleRequest({
        method: `${machineId}:listOpencodeModelsForCwd`,
        params: JSON.stringify({ cwd })
    })
    return JSON.parse(raw) as unknown
}

async function callMachineRpc(client: ApiMachineClient, machineId: string, method: string, params: unknown): Promise<unknown> {
    const manager = (client as unknown as { rpcHandlerManager: { handleRequest: (req: { method: string; params: string }) => Promise<string> } }).rpcHandlerManager
    const raw = await manager.handleRequest({
        method: `${machineId}:${method}`,
        params: JSON.stringify(params)
    })
    return JSON.parse(raw) as unknown
}

describe('ApiMachineClient listOpencodeModelsForCwd handler', () => {
    let workspaceRoot: string

    beforeEach(() => {
        ioMock.mockReset()
        listOpencodeModelsForCwdMock.mockReset()
        workspaceRoot = mkdtempSync(join(tmpdir(), 'hapi-machine-ws-'))
    })

    afterEach(() => {
        rmSync(workspaceRoot, { recursive: true, force: true })
    })

    it('rejects cwd outside the workspace root with the standard error shape', async () => {
        const machine = makeMachine('machine-1')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])

        const outsideCwd = mkdtempSync(join(tmpdir(), 'hapi-outside-'))
        try {
            const result = await callListOpencodeModels(client, machine.id, outsideCwd)
            expect(result).toEqual({ success: false, error: 'Path is outside workspace roots' })
            expect(listOpencodeModelsForCwdMock).not.toHaveBeenCalled()
        } finally {
            rmSync(outsideCwd, { recursive: true, force: true })
            client.shutdown()
        }
    })

    it('rejects empty cwd with cwd-required error', async () => {
        const machine = makeMachine('machine-2')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])

        try {
            const result = await callListOpencodeModels(client, machine.id, '')
            expect(result).toEqual({ success: false, error: 'cwd is required' })
            expect(listOpencodeModelsForCwdMock).not.toHaveBeenCalled()
        } finally {
            client.shutdown()
        }
    })

    it('forwards a workspace-internal cwd to listOpencodeModelsForCwd', async () => {
        const machine = makeMachine('machine-3')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])

        const innerDir = join(workspaceRoot, 'inner-project')
        mkdirSync(innerDir)

        listOpencodeModelsForCwdMock.mockResolvedValueOnce({
            success: true,
            availableModels: [{ modelId: 'a/b' }],
            currentModelId: 'a/b'
        })

        try {
            const result = await callListOpencodeModels(client, machine.id, innerDir)
            expect(result).toEqual({
                success: true,
                availableModels: [{ modelId: 'a/b' }],
                currentModelId: 'a/b'
            })
            expect(listOpencodeModelsForCwdMock).toHaveBeenCalledTimes(1)
            // The handler should pass the resolved (realpath'd) cwd to the lower layer.
            expect(listOpencodeModelsForCwdMock).toHaveBeenCalledWith(expect.stringContaining('inner-project'))
        } finally {
            client.shutdown()
        }
    })

    it('accepts cwd inside any configured workspace root', async () => {
        const machine = makeMachine('machine-4')
        const secondWorkspaceRoot = mkdtempSync(join(tmpdir(), 'hapi-machine-ws-2-'))
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot, secondWorkspaceRoot])

        listOpencodeModelsForCwdMock.mockResolvedValueOnce({
            success: true,
            availableModels: [{ modelId: 'x/y' }],
            currentModelId: 'x/y'
        })

        try {
            const result = await callListOpencodeModels(client, machine.id, secondWorkspaceRoot)
            expect(result).toEqual({
                success: true,
                availableModels: [{ modelId: 'x/y' }],
                currentModelId: 'x/y'
            })
            expect(listOpencodeModelsForCwdMock).toHaveBeenCalledWith(realpathSync(secondWorkspaceRoot))
        } finally {
            rmSync(secondWorkspaceRoot, { recursive: true, force: true })
            client.shutdown()
        }
    })
})

describe('ApiMachineClient project-tools handlers', () => {
    let workspaceRoot: string

    beforeEach(() => {
        ioMock.mockReset()
        listOpencodeModelsForCwdMock.mockReset()
        workspaceRoot = mkdtempSync(join(tmpdir(), 'hapi-machine-project-tools-'))
    })

    afterEach(() => {
        rmSync(workspaceRoot, { recursive: true, force: true })
    })

    it('registers project-tools RPC methods with the machine scope', () => {
        const machine = makeMachine('machine-tools-1')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])
        const manager = (client as unknown as { rpcHandlerManager: { hasHandler: (method: string) => boolean } }).rpcHandlerManager

        try {
            expect(manager.hasHandler('project-tools:list')).toBe(true)
            expect(manager.hasHandler('project-tools:counts')).toBe(true)
            expect(manager.hasHandler('project-tools:upsert')).toBe(true)
            expect(manager.hasHandler('project-tools:delete')).toBe(true)
        } finally {
            client.shutdown()
        }
    })

    it('allows project-tools RPC when workspace roots are empty', async () => {
        const machine = makeMachine('machine-tools-2')
        const client = new ApiMachineClient('cli-token', machine, [])
        const projectPath = join(workspaceRoot, 'project-without-roots')
        mkdirSync(projectPath, { recursive: true })

        try {
            const result = await callMachineRpc(client, machine.id, 'project-tools:upsert', {
                machineId: machine.id,
                projectPath,
                kind: 'agent',
                id: 'reviewer',
                value: {
                    id: 'reviewer',
                    name: 'Reviewer',
                    prompt: 'Review the current diff.',
                    agent: 'codex',
                    permissionMode: 'acceptEdits'
                }
            })

            expect(result).toMatchObject({ success: true, id: 'reviewer' })
        } finally {
            client.shutdown()
        }
    })

    it('manages project tools through machine-scoped RPC handlers', async () => {
        const machine = makeMachine('machine-tools-3')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])
        const projectPath = join(workspaceRoot, 'project')
        mkdirSync(projectPath, { recursive: true })

        try {
            const upserted = await callMachineRpc(client, machine.id, 'project-tools:upsert', {
                machineId: machine.id,
                projectPath,
                kind: 'agent',
                id: 'reviewer',
                value: {
                    id: 'reviewer',
                    name: 'Reviewer',
                    prompt: 'Review the current diff.',
                    agent: 'codex',
                    permissionMode: 'acceptEdits'
                }
            }) as { success: boolean; hash?: string }

            expect(upserted.success).toBe(true)
            expect(upserted.hash).toMatch(/^[a-f0-9]{64}$/)

            const listed = await callMachineRpc(client, machine.id, 'project-tools:list', {
                machineId: machine.id,
                projectPath,
                kind: 'agent'
            }) as { success: boolean; items?: Array<{ id: string; hash: string }> }

            expect(listed.success).toBe(true)
            expect(listed.items?.map((item) => item.id)).toEqual(['reviewer'])
            expect(listed.items?.[0]?.hash).toBe(upserted.hash)

            const counts = await callMachineRpc(client, machine.id, 'project-tools:counts', {
                projects: [{ machineId: machine.id, projectPath }]
            }) as { success: boolean; counts?: Array<{ counts: { agents: number; crons: number } }> }

            expect(counts).toMatchObject({
                success: true,
                counts: [{ counts: { agents: 1, crons: 0 } }]
            })

            const deleted = await callMachineRpc(client, machine.id, 'project-tools:delete', {
                machineId: machine.id,
                projectPath,
                kind: 'agent',
                id: 'reviewer',
                expectedHash: upserted.hash
            }) as { success: boolean }

            expect(deleted.success).toBe(true)
        } finally {
            client.shutdown()
        }
    })

    it('rejects project-tools RPC requests for another machine id', async () => {
        const machine = makeMachine('machine-tools-4')
        const client = new ApiMachineClient('cli-token', machine, [workspaceRoot])

        try {
            const result = await callMachineRpc(client, machine.id, 'project-tools:list', {
                machineId: 'other-machine',
                projectPath: workspaceRoot,
                kind: 'agent'
            })

            expect(result).toEqual({
                success: false,
                error: 'machineId does not match this runner'
            })
        } finally {
            client.shutdown()
        }
    })
})
