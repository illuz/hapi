import { describe, expect, it } from 'bun:test'
import { Store, type StoredCronRun } from '../store'
import { computeDueScheduledAt, CronScheduler, executeCronRun, triggerProjectCronRun } from './cronScheduler'
import type { ProjectCronConfig } from '@hapi/protocol/projectTools'

type FakeEngine = {
    active: boolean
    crons: ProjectCronConfig[]
    events: unknown[]
    starts: unknown[]
    archives: string[]
    listProjectCrons: (params: { machineId: string; namespace: string; projectPath: string }) => Promise<{ type: 'success'; projectPath: string; crons: ProjectCronConfig[] }>
    startProjectCron: (params: unknown) => Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string; code: string }>
    archiveCronSession: (sessionId: string) => Promise<boolean>
    handleRealtimeEvent: (event: unknown) => void
    getMachine: () => { active: boolean } | undefined
}

function createCron(overrides?: Partial<ProjectCronConfig>): ProjectCronConfig {
    return {
        id: 'daily_cron',
        prompt: 'Run maintenance',
        schedule: { type: 'interval', everyMinutes: 5 },
        agent: 'codex',
        model: 'gpt-5.4',
        permissionMode: 'safe-yolo',
        ...overrides
    }
}

function createEngine(options?: {
    active?: boolean
    crons?: ProjectCronConfig[]
    startResult?: { type: 'success'; sessionId: string } | { type: 'error'; message: string; code: string }
    archiveResult?: boolean
    delayList?: () => Promise<void>
}): FakeEngine {
    const engine: FakeEngine = {
        active: options?.active ?? true,
        crons: options?.crons ?? [createCron()],
        events: [],
        starts: [],
        archives: [],
        getMachine: () => ({ active: engine.active }),
        listProjectCrons: async (params) => {
            await options?.delayList?.()
            return { type: 'success', projectPath: params.projectPath, crons: engine.crons }
        },
        startProjectCron: async (params) => {
            engine.starts.push(params)
            return options?.startResult ?? { type: 'success', sessionId: 'session-1' }
        },
        archiveCronSession: async (sessionId) => {
            engine.archives.push(sessionId)
            return options?.archiveResult ?? true
        },
        handleRealtimeEvent: (event) => {
            engine.events.push(event)
        }
    }
    return engine
}

describe('CronScheduler', () => {
    it('computes interval and daily due times while ignoring manual schedules', () => {
        const now = new Date('2026-05-17T10:30:00').getTime()
        expect(computeDueScheduledAt(createCron({ schedule: { type: 'manual' } }), null, now)).toBeNull()
        expect(computeDueScheduledAt(createCron({ schedule: { type: 'interval', everyMinutes: 5 } }), null, now)).toBe(now)
        expect(computeDueScheduledAt(
            createCron({ schedule: { type: 'interval', everyMinutes: 5 } }),
            { scheduledAt: now - 6 * 60_000, status: 'completed' } as StoredCronRun,
            now
        )).toBe(now - 60_000)
        expect(computeDueScheduledAt(
            createCron({ schedule: { type: 'daily', time: '09:00' } }),
            null,
            now
        )).toBe(new Date('2026-05-17T09:00:00').getTime())
        expect(computeDueScheduledAt(
            createCron({ schedule: { type: 'daily', time: '23:00' } }),
            null,
            now
        )).toBeNull()
    })

    it('claims due runs, starts cron session with metadata ids, sends cron source through service path, and archives', async () => {
        const store = new Store(':memory:')
        const engine = createEngine()
        store.cronRuns.registerProject({ namespace: 'default', machineId: 'm1', projectPath: '/repo', now: 1_000 })

        const scheduler = new CronScheduler({
            store,
            syncEngine: engine as never,
            now: () => 10_000,
            intervalMs: 60_000,
            sessionTimeoutMs: 1_000
        })
        await scheduler.tick()

        const runs = store.cronRuns.listRuns({ namespace: 'default' })
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({
            status: 'completed',
            sessionId: 'session-1',
            cronId: 'daily_cron'
        })
        expect(engine.starts).toEqual([{
            machineId: 'm1',
            namespace: 'default',
            projectPath: '/repo',
            cronRunId: runs[0].id,
            config: createCron()
        }])
        expect(engine.archives).toEqual(['session-1'])
        expect(engine.events).toContainEqual(expect.objectContaining({
            type: 'cron-run-updated',
            cronRunId: runs[0].id,
            cronId: 'daily_cron'
        }))
    })

    it('does not create runs when the known machine is offline', async () => {
        const store = new Store(':memory:')
        const engine = createEngine({ active: false })
        store.cronRuns.registerProject({ namespace: 'default', machineId: 'm1', projectPath: '/repo', now: 1_000 })

        const scheduler = new CronScheduler({ store, syncEngine: engine as never, now: () => 10_000 })
        await scheduler.tick()

        expect(store.cronRuns.listRuns({ namespace: 'default' })).toEqual([])
        expect(engine.starts).toEqual([])
    })

    it('skips reentrant ticks so duplicate runs are not created', async () => {
        const store = new Store(':memory:')
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        const engine = createEngine({ delayList: () => gate })
        store.cronRuns.registerProject({ namespace: 'default', machineId: 'm1', projectPath: '/repo', now: 1_000 })
        const scheduler = new CronScheduler({ store, syncEngine: engine as never, now: () => 10_000 })

        const first = scheduler.tick()
        await scheduler.tick()
        release()
        await first

        expect(store.cronRuns.listRuns({ namespace: 'default' })).toHaveLength(1)
        expect(engine.starts).toHaveLength(1)
    })

    it('marks a claimed run failed when project cron start fails', async () => {
        const store = new Store(':memory:')
        const engine = createEngine({ startResult: { type: 'error', message: 'spawn failed', code: 'spawn_failed' } })
        const run = store.cronRuns.createRunIfAbsent({
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            cronId: 'daily_cron',
            scheduledAt: 10_000,
            now: 10_000
        })

        const result = await executeCronRun({
            store,
            syncEngine: engine as never,
            now: () => 10_000,
            waitForCompletion: true
        }, run, createCron())

        expect(result).toMatchObject({ status: 'failed', error: 'spawn failed' })
    })

    it('manual trigger creates a run and returns before completion while execution continues', async () => {
        const store = new Store(':memory:')
        const engine = createEngine({ crons: [createCron({ schedule: { type: 'manual' } })] })

        const result = await triggerProjectCronRun({
            store,
            syncEngine: engine as never,
            namespace: 'default',
            machineId: 'm1',
            projectPath: '/repo',
            cronId: 'daily_cron',
            now: () => 20_000
        })

        expect(result.type).toBe('success')
        if (result.type === 'success') {
            expect(result.sessionId).toBe('session-1')
            expect(result.run.id).toBeTruthy()
        }
        expect(engine.starts).toHaveLength(1)
    })
})
