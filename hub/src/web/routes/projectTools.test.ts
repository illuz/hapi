import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createProjectToolsRoutes } from './projectTools'

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides
    }
}

function createApp(options?: {
    namespace?: string
    engine?: Partial<SyncEngine> | null
    machine?: Machine | null
}) {
    const machine = options?.machine === undefined ? createMachine() : options.machine
    const engine = options?.engine === undefined
        ? {
            getMachine: () => machine,
            listProjectTools: async () => ({
                success: true,
                kind: 'agent',
                projectPath: '/repo',
                items: []
            })
        } as Partial<SyncEngine>
        : options.engine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', options?.namespace ?? 'default')
        await next()
    })
    app.route('/api', createProjectToolsRoutes(() => engine as SyncEngine | null))
    return app
}

describe('project tools routes', () => {
    it('returns 503 when sync engine is unavailable', async () => {
        const app = createApp({ engine: null })

        const response = await app.request('/api/machines/machine-1/project-tools/agent?projectPath=/repo')

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ error: 'Not connected' })
    })

    it('returns 404 for an unknown machine', async () => {
        const app = createApp({ machine: null })

        const response = await app.request('/api/machines/missing/project-tools/agent?projectPath=/repo')

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Machine not found' })
    })

    it('returns 403 when the machine belongs to another namespace', async () => {
        const app = createApp({ machine: createMachine({ namespace: 'other' }) })

        const response = await app.request('/api/machines/machine-1/project-tools/agent?projectPath=/repo')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Machine access denied' })
    })

    it('preserves RPC failure shape for list failures', async () => {
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                listProjectTools: async () => ({
                    success: false,
                    error: 'runner exploded'
                })
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/project-tools/agent?projectPath=/repo')

        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({
            success: false,
            error: 'runner exploded'
        })
    })

    it('starts project agents through the sync engine with namespace and project path', async () => {
        const calls: unknown[] = []
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                startProjectAgent: async (params: unknown) => {
                    calls.push(params)
                    return { type: 'success', sessionId: 'session-1' }
                }
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/project-tools/agents/reviewer/start', {
            method: 'POST',
            body: JSON.stringify({ projectPath: '/repo' }),
            headers: { 'content-type': 'application/json' }
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'session-1' })
        expect(calls).toEqual([{
            machineId: 'machine-1',
            namespace: 'default',
            projectPath: '/repo',
            agentId: 'reviewer'
        }])
    })

    it('lists cron runs through the sync engine with namespace, machine, and query filters', async () => {
        const calls: unknown[] = []
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                listCronRuns: (params: unknown) => {
                    calls.push(params)
                    return [{
                        id: 'run-1',
                        namespace: 'default',
                        machineId: 'machine-1',
                        projectPath: '/repo',
                        cronId: 'daily',
                        sessionId: 'session-1',
                        status: 'completed',
                        scheduledAt: 1,
                        queuedAt: 1,
                        startedAt: 2,
                        finishedAt: 3,
                        error: null,
                        createdAt: 1,
                        updatedAt: 3
                    }]
                }
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/project-tools/cron-runs?projectPath=/repo&cronId=daily&limit=20')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            runs: [{
                id: 'run-1',
                namespace: 'default',
                machineId: 'machine-1',
                projectPath: '/repo',
                cronId: 'daily',
                sessionId: 'session-1',
                status: 'completed',
                scheduledAt: 1,
                queuedAt: 1,
                startedAt: 2,
                finishedAt: 3,
                error: null,
                createdAt: 1,
                updatedAt: 3
            }]
        })
        expect(calls).toEqual([{
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            cronId: 'daily',
            limit: 20
        }])
    })

    it('manual triggers project crons through the sync engine', async () => {
        const calls: unknown[] = []
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                triggerProjectCron: async (params: unknown) => {
                    calls.push(params)
                    return { type: 'success', cronRunId: 'run-1', sessionId: 'session-1' }
                }
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/project-tools/cron/daily/run', {
            method: 'POST',
            body: JSON.stringify({ projectPath: '/repo' }),
            headers: { 'content-type': 'application/json' }
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ type: 'success', cronRunId: 'run-1', sessionId: 'session-1' })
        expect(calls).toEqual([{
            machineId: 'machine-1',
            namespace: 'default',
            projectPath: '/repo',
            cronId: 'daily'
        }])
    })
})
