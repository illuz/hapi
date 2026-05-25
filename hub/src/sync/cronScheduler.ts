import type { ProjectCronConfig } from '@hapi/protocol/projectTools'
import type { SyncEvent } from '@hapi/protocol/types'
import type { Store, StoredCronProject, StoredCronRun } from '../store'
import type { Machine, SyncEngine } from './syncEngine'

type CronStoreDeps = Pick<Store, 'cronRuns'>

type CronSchedulerSyncEngine = Pick<
    SyncEngine,
    | 'getMachine'
    | 'listProjectCrons'
    | 'startProjectCron'
    | 'archiveCronSession'
    | 'handleRealtimeEvent'
>

type CronRunExecutionDeps = {
    store: CronStoreDeps
    syncEngine: Pick<CronSchedulerSyncEngine, 'startProjectCron' | 'archiveCronSession' | 'handleRealtimeEvent'>
    now?: () => number
    sessionTimeoutMs?: number
    waitForCompletion?: boolean
}

export type CronSchedulerOptions = {
    store: CronStoreDeps
    syncEngine: CronSchedulerSyncEngine
    intervalMs?: number
    sessionTimeoutMs?: number
    now?: () => number
}

export class CronScheduler {
    private readonly intervalMs: number
    private readonly sessionTimeoutMs: number
    private readonly now: () => number
    private timer: ReturnType<typeof setInterval> | null = null
    private tickInProgress = false

    constructor(private readonly options: CronSchedulerOptions) {
        this.intervalMs = options.intervalMs ?? 30_000
        this.sessionTimeoutMs = options.sessionTimeoutMs ?? 30 * 60_000
        this.now = options.now ?? (() => Date.now())
    }

    start(): void {
        if (this.timer) {
            return
        }
        this.timer = setInterval(() => {
            void this.tick()
        }, this.intervalMs)
        void this.tick()
    }

    stop(): void {
        if (!this.timer) {
            return
        }
        clearInterval(this.timer)
        this.timer = null
    }

    async tick(): Promise<void> {
        if (this.tickInProgress) {
            return
        }

        this.tickInProgress = true
        try {
            await this.runTick()
        } finally {
            this.tickInProgress = false
        }
    }

    private async runTick(): Promise<void> {
        const projects = this.options.store.cronRuns.listProjects({ enabledOnly: true })
        for (const project of projects) {
            await this.processProject(project)
        }
    }

    private async processProject(project: StoredCronProject): Promise<void> {
        const machine = this.options.syncEngine.getMachine(project.machineId) as Machine | undefined
        if (!machine?.active) {
            return
        }

        const listed = await this.options.syncEngine.listProjectCrons({
            machineId: project.machineId,
            namespace: project.namespace,
            projectPath: project.projectPath
        })
        if (listed.type === 'error') {
            return
        }

        const now = this.now()
        this.options.store.cronRuns.markProjectLoaded(project.namespace, project.machineId, listed.projectPath, now)

        for (const config of listed.crons) {
            if (config.enabled === false) {
                continue
            }

            const lastRun = this.options.store.cronRuns.getLastRunForCron({
                namespace: project.namespace,
                machineId: project.machineId,
                projectPath: listed.projectPath,
                cronId: config.id
            })
            const scheduledAt = computeDueScheduledAt(config, lastRun, now)
            if (scheduledAt === null) {
                continue
            }

            const run = this.options.store.cronRuns.createRunIfAbsent({
                namespace: project.namespace,
                machineId: project.machineId,
                projectPath: listed.projectPath,
                cronId: config.id,
                scheduledAt,
                now
            })
            emitCronRunUpdated(this.options.syncEngine, run)
            await executeCronRun({
                store: this.options.store,
                syncEngine: this.options.syncEngine,
                now: this.now,
                sessionTimeoutMs: this.sessionTimeoutMs,
                waitForCompletion: true
            }, run, config)
        }
    }
}

export async function executeCronRun(
    deps: CronRunExecutionDeps,
    run: StoredCronRun,
    config: ProjectCronConfig
): Promise<StoredCronRun | null> {
    const now = deps.now ?? (() => Date.now())
    const claimed = deps.store.cronRuns.claimRun({ id: run.id, now: now() })
    if (!claimed) {
        return null
    }
    emitCronRunUpdated(deps.syncEngine, claimed)

    // startProjectCron writes metadata.cronRunId / metadata.cronId and sends sentFrom:'cron'.
    const started = await deps.syncEngine.startProjectCron({
        machineId: claimed.machineId,
        namespace: claimed.namespace,
        projectPath: claimed.projectPath,
        cronRunId: claimed.id,
        config
    })

    if (started.type === 'error') {
        const failed = deps.store.cronRuns.finishRun({
            id: claimed.id,
            status: 'failed',
            error: started.message,
            now: now()
        })
        if (failed) {
            emitCronRunUpdated(deps.syncEngine, failed)
        }
        return failed
    }

    deps.store.cronRuns.attachSession(claimed.id, started.sessionId, now())
    const attached = deps.store.cronRuns.getRun(claimed.id) ?? claimed
    emitCronRunUpdated(deps.syncEngine, attached)

    const finish = async () => {
        // archiveCronSession waits for session end, then falls back to archiveSession after timeout.
        const endedBeforeArchive = await deps.syncEngine.archiveCronSession(started.sessionId, deps.sessionTimeoutMs)
        const finished = deps.store.cronRuns.finishRun({
            id: claimed.id,
            status: endedBeforeArchive ? 'completed' : 'failed',
            error: endedBeforeArchive ? null : 'Cron session timed out before completion',
            now: now()
        })
        if (finished) {
            emitCronRunUpdated(deps.syncEngine, finished)
        }
        return finished
    }

    if (deps.waitForCompletion === false) {
        void finish().catch((error) => {
            const failed = deps.store.cronRuns.finishRun({
                id: claimed.id,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Cron run failed',
                now: now()
            })
            if (failed) {
                emitCronRunUpdated(deps.syncEngine, failed)
            }
        })
        return attached
    }

    return await finish()
}

export async function triggerProjectCronRun(params: {
    store: CronStoreDeps
    syncEngine: Pick<CronSchedulerSyncEngine, 'listProjectCrons' | 'startProjectCron' | 'archiveCronSession' | 'handleRealtimeEvent'>
    namespace: string
    machineId: string
    projectPath: string
    cronId: string
    now?: () => number
    sessionTimeoutMs?: number
}): Promise<{ type: 'success'; run: StoredCronRun; sessionId?: string | null } | { type: 'error'; message: string; code: string }> {
    const now = params.now ?? (() => Date.now())
    const listed = await params.syncEngine.listProjectCrons({
        machineId: params.machineId,
        namespace: params.namespace,
        projectPath: params.projectPath
    })
    if (listed.type === 'error') {
        return { type: 'error', message: listed.message, code: 'project_tools_rpc_failed' }
    }

    const config = listed.crons.find((cron) => cron.id === params.cronId)
    if (!config) {
        return { type: 'error', message: 'Project cron not found', code: 'cron_not_found' }
    }
    if (config.enabled === false) {
        return { type: 'error', message: 'Project cron is disabled', code: 'cron_disabled' }
    }

    const run = params.store.cronRuns.createRunIfAbsent({
        namespace: params.namespace,
        machineId: params.machineId,
        projectPath: listed.projectPath,
        cronId: config.id,
        scheduledAt: now(),
        now: now()
    })
    emitCronRunUpdated(params.syncEngine, run)

    const result = await executeCronRun({
        store: params.store,
        syncEngine: params.syncEngine,
        now,
        sessionTimeoutMs: params.sessionTimeoutMs,
        waitForCompletion: false
    }, run, config)

    const latest = result ?? params.store.cronRuns.getRun(run.id) ?? run
    return { type: 'success', run: latest, sessionId: latest.sessionId }
}

export function computeDueScheduledAt(
    config: ProjectCronConfig,
    lastRun: StoredCronRun | null,
    now: number
): number | null {
    if (config.enabled === false) {
        return null
    }

    if (lastRun?.status === 'queued' || lastRun?.status === 'running') {
        return null
    }

    const schedule = config.schedule
    if (schedule.type === 'manual') {
        return null
    }

    if (schedule.type === 'interval') {
        const everyMs = schedule.everyMinutes * 60_000
        if (!lastRun) {
            return now
        }
        const dueAt = lastRun.scheduledAt + everyMs
        return dueAt <= now ? dueAt : null
    }

    const [hours, minutes] = schedule.time.split(':').map((value) => Number.parseInt(value, 10))
    const dueDate = new Date(now)
    dueDate.setHours(hours, minutes, 0, 0)
    const dueAt = dueDate.getTime()
    if (dueAt > now) {
        return null
    }
    if (lastRun && lastRun.scheduledAt >= dueAt) {
        return null
    }
    return dueAt
}

function emitCronRunUpdated(syncEngine: Pick<SyncEngine, 'handleRealtimeEvent'>, run: StoredCronRun): void {
    const event: SyncEvent = {
        type: 'cron-run-updated',
        namespace: run.namespace,
        machineId: run.machineId,
        projectPath: run.projectPath,
        cronId: run.cronId,
        cronRunId: run.id
    }
    syncEngine.handleRealtimeEvent(event)
}
