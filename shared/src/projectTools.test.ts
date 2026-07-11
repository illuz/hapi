import { describe, expect, test } from 'bun:test'
import {
    CronRunStatusSchema,
    ProjectAgentConfigSchema,
    ProjectCronConfigSchema,
    ProjectToolCountsSchema,
    ProjectToolIdSchema,
    toSessionSummary,
    type Session
} from './index'
import { MetadataSchema, SyncEventSchema } from './schemas'

describe('ProjectToolIdSchema', () => {
    test('accepts simple ids and trims whitespace', () => {
        expect(ProjectToolIdSchema.parse(' build_bot-1 ')).toBe('build_bot-1')
    })

    test('rejects path-like ids and json filenames', () => {
        for (const value of ['../x', 'x/y', 'x.json']) {
            expect(ProjectToolIdSchema.safeParse(value).success).toBe(false)
        }
    })
})

describe('project tool config schemas', () => {
    test('parses project agent configs', () => {
        const parsed = ProjectAgentConfigSchema.parse({
            id: 'reviewer',
            name: 'Reviewer',
            prompt: 'Review the current diff.',
            agent: 'codex',
            model: 'gpt-5.5',
            modelReasoningEffort: 'medium',
            permissionMode: 'read-only',
            enabled: true,
            createdAt: 1,
            updatedAt: 2
        })

        expect(parsed.id).toBe('reviewer')
        expect(parsed.agent).toBe('codex')
    })

    test('rejects invalid agent flavor and permission mode', () => {
        expect(ProjectAgentConfigSchema.safeParse({
            id: 'bad-agent',
            prompt: 'Run checks.',
            agent: 'unknown'
        }).success).toBe(false)

        expect(ProjectAgentConfigSchema.safeParse({
            id: 'bad-permission',
            prompt: 'Run checks.',
            permissionMode: 'root'
        }).success).toBe(false)
    })

    test('parses supported cron schedules', () => {
        expect(ProjectCronConfigSchema.parse({
            id: 'manual',
            prompt: 'Run manually.',
            schedule: { type: 'manual' }
        }).schedule.type).toBe('manual')

        expect(ProjectCronConfigSchema.parse({
            id: 'interval',
            prompt: 'Run periodically.',
            schedule: { type: 'interval', everyMinutes: 30 }
        }).schedule.type).toBe('interval')

        expect(ProjectCronConfigSchema.parse({
            id: 'daily',
            prompt: 'Run daily.',
            schedule: { type: 'daily', time: '09:30', timezone: 'Asia/Shanghai' }
        }).schedule.type).toBe('daily')
    })

    test('rejects invalid cron schedules', () => {
        expect(ProjectCronConfigSchema.safeParse({
            id: 'bad-interval',
            prompt: 'Run periodically.',
            schedule: { type: 'interval', everyMinutes: 0 }
        }).success).toBe(false)

        expect(ProjectCronConfigSchema.safeParse({
            id: 'bad-daily',
            prompt: 'Run daily.',
            schedule: { type: 'daily', time: '25:00' }
        }).success).toBe(false)
    })

    test('parses counts and cron statuses', () => {
        expect(ProjectToolCountsSchema.parse({ agents: 2, crons: 1, runningCronRuns: 1 })).toEqual({
            agents: 2,
            crons: 1,
            runningCronRuns: 1
        })
        expect(CronRunStatusSchema.parse('running')).toBe('running')
    })
})

describe('project tool metadata propagation', () => {
    test('metadata schema keeps project tool ids', () => {
        const metadata = MetadataSchema.parse({
            path: '/repo',
            host: 'localhost',
            agentId: 'reviewer',
            cronId: 'nightly',
            cronRunId: 'run-1'
        })

        expect(metadata.agentId).toBe('reviewer')
        expect(metadata.cronId).toBe('nightly')
        expect(metadata.cronRunId).toBe('run-1')
    })

    test('session summaries expose project tool ids without changing agentSessionId', () => {
        const session: Session = {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: {
                path: '/repo',
                host: 'localhost',
                agentId: 'reviewer',
                cronId: 'nightly',
                cronRunId: 'run-1',
                codexSessionId: 'codex-session-1'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 2,
            markerColor: null,
            model: null,
            modelReasoningEffort: null,
            effort: null
        }

        const summary = toSessionSummary(session)

        expect(summary.metadata?.agentId).toBe('reviewer')
        expect(summary.metadata?.cronId).toBe('nightly')
        expect(summary.metadata?.cronRunId).toBe('run-1')
        expect(summary.metadata?.agentSessionId).toBe('codex-session-1')
    })
})

describe('project tool sync events', () => {
    test('parses project tool update events', () => {
        expect(SyncEventSchema.parse({
            type: 'project-tools-updated',
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            kind: 'agent'
        }).type).toBe('project-tools-updated')
    })

    test('parses cron run update events', () => {
        expect(SyncEventSchema.parse({
            type: 'cron-run-updated',
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            cronId: 'nightly',
            cronRunId: 'run-1'
        }).type).toBe('cron-run-updated')
    })
})
