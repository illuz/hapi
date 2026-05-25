import { z } from 'zod'
import { PermissionModeSchema } from './schemas'

const NonEmptyTrimmedStringSchema = z.string().trim().min(1)
const TimestampSchema = z.number().int().nonnegative()

export const ProjectToolIdSchema = z.string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9_-]+$/, 'Project tool id can only contain letters, numbers, underscores, and hyphens')

export const ProjectToolKindSchema = z.enum(['agent', 'cron'])
export const ProjectToolAgentSchema = z.enum(['claude', 'codex', 'cursor', 'gemini', 'opencode'])

const ProjectToolBaseConfigSchema = z.object({
    id: ProjectToolIdSchema,
    name: NonEmptyTrimmedStringSchema.optional(),
    prompt: NonEmptyTrimmedStringSchema,
    agent: ProjectToolAgentSchema.optional(),
    model: NonEmptyTrimmedStringSchema.optional(),
    effort: NonEmptyTrimmedStringSchema.optional(),
    modelReasoningEffort: NonEmptyTrimmedStringSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    enabled: z.boolean().optional(),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema.optional()
})

export const ProjectAgentConfigSchema = ProjectToolBaseConfigSchema

export const ProjectCronManualScheduleSchema = z.object({
    type: z.literal('manual')
})

export const ProjectCronIntervalScheduleSchema = z.object({
    type: z.literal('interval'),
    everyMinutes: z.number().int().positive()
})

export const ProjectCronDailyScheduleSchema = z.object({
    type: z.literal('daily'),
    time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm in 24-hour format'),
    timezone: NonEmptyTrimmedStringSchema.optional()
})

// First version intentionally supports only manual, interval, and daily schedules.
// Future extensions can add cron expression schedules here once scheduling semantics are agreed.
export const ProjectCronScheduleSchema = z.discriminatedUnion('type', [
    ProjectCronManualScheduleSchema,
    ProjectCronIntervalScheduleSchema,
    ProjectCronDailyScheduleSchema
])

export const ProjectCronConfigSchema = ProjectToolBaseConfigSchema.extend({
    schedule: ProjectCronScheduleSchema
})

export const ProjectAgentToolFileSchema = z.object({
    kind: z.literal('agent'),
    id: ProjectToolIdSchema,
    path: NonEmptyTrimmedStringSchema,
    config: ProjectAgentConfigSchema
})

export const ProjectCronToolFileSchema = z.object({
    kind: z.literal('cron'),
    id: ProjectToolIdSchema,
    path: NonEmptyTrimmedStringSchema,
    config: ProjectCronConfigSchema
})

export const ProjectToolFileSchema = z.discriminatedUnion('kind', [
    ProjectAgentToolFileSchema,
    ProjectCronToolFileSchema
])

export const ProjectAgentListResponseSchema = z.object({
    kind: z.literal('agent'),
    projectPath: NonEmptyTrimmedStringSchema,
    items: z.array(ProjectAgentToolFileSchema)
})

export const ProjectCronListResponseSchema = z.object({
    kind: z.literal('cron'),
    projectPath: NonEmptyTrimmedStringSchema,
    items: z.array(ProjectCronToolFileSchema)
})

export const ProjectToolListResponseSchema = z.discriminatedUnion('kind', [
    ProjectAgentListResponseSchema,
    ProjectCronListResponseSchema
])

export const ProjectToolCountsSchema = z.object({
    agents: z.number().int().nonnegative(),
    crons: z.number().int().nonnegative(),
    runningCronRuns: z.number().int().nonnegative().optional()
})

export const ProjectToolCountsRequestSchema = z.object({
    machineId: NonEmptyTrimmedStringSchema,
    projectPath: NonEmptyTrimmedStringSchema
})

export const ProjectToolCountsResultSchema = ProjectToolCountsRequestSchema.extend({
    counts: ProjectToolCountsSchema
})

export const ProjectToolBatchCountsRequestSchema = z.object({
    projects: z.array(ProjectToolCountsRequestSchema)
})

export const ProjectToolBatchCountsResponseSchema = z.object({
    counts: z.array(ProjectToolCountsResultSchema)
})

export const ProjectToolReadRequestSchema = z.object({
    projectPath: NonEmptyTrimmedStringSchema,
    kind: ProjectToolKindSchema,
    id: ProjectToolIdSchema
})

export const ProjectToolDeleteRequestSchema = ProjectToolReadRequestSchema

export const ProjectAgentWriteRequestSchema = z.object({
    projectPath: NonEmptyTrimmedStringSchema,
    kind: z.literal('agent'),
    config: ProjectAgentConfigSchema
})

export const ProjectCronWriteRequestSchema = z.object({
    projectPath: NonEmptyTrimmedStringSchema,
    kind: z.literal('cron'),
    config: ProjectCronConfigSchema
})

export const ProjectToolWriteRequestSchema = z.discriminatedUnion('kind', [
    ProjectAgentWriteRequestSchema,
    ProjectCronWriteRequestSchema
])

export const ProjectToolMutationResponseSchema = z.object({
    ok: z.boolean(),
    kind: ProjectToolKindSchema,
    projectPath: NonEmptyTrimmedStringSchema,
    id: ProjectToolIdSchema,
    item: ProjectToolFileSchema.optional()
})

export const CronRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])

export const CronRunRecordSchema = z.object({
    cronRunId: NonEmptyTrimmedStringSchema,
    cronId: ProjectToolIdSchema,
    projectPath: NonEmptyTrimmedStringSchema,
    machineId: NonEmptyTrimmedStringSchema.optional(),
    namespace: NonEmptyTrimmedStringSchema.optional(),
    sessionId: NonEmptyTrimmedStringSchema.optional(),
    status: CronRunStatusSchema,
    queuedAt: TimestampSchema.optional(),
    startedAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
    error: z.string().optional()
})

export const ProjectToolsUpdatedEventSchema = z.object({
    namespace: NonEmptyTrimmedStringSchema.optional(),
    machineId: NonEmptyTrimmedStringSchema,
    projectPath: NonEmptyTrimmedStringSchema,
    kind: ProjectToolKindSchema.optional(),
    counts: ProjectToolCountsSchema.optional()
})

export const CronRunUpdatedEventSchema = z.object({
    namespace: NonEmptyTrimmedStringSchema.optional(),
    machineId: NonEmptyTrimmedStringSchema.optional(),
    projectPath: NonEmptyTrimmedStringSchema.optional(),
    cronId: ProjectToolIdSchema.optional(),
    cronRunId: NonEmptyTrimmedStringSchema.optional(),
    status: CronRunStatusSchema.optional(),
    sessionId: NonEmptyTrimmedStringSchema.optional(),
    updatedAt: TimestampSchema.optional()
})

export type ProjectToolId = z.infer<typeof ProjectToolIdSchema>
export type ProjectToolKind = z.infer<typeof ProjectToolKindSchema>
export type ProjectToolAgent = z.infer<typeof ProjectToolAgentSchema>
export type ProjectAgentConfig = z.infer<typeof ProjectAgentConfigSchema>
export type ProjectCronManualSchedule = z.infer<typeof ProjectCronManualScheduleSchema>
export type ProjectCronIntervalSchedule = z.infer<typeof ProjectCronIntervalScheduleSchema>
export type ProjectCronDailySchedule = z.infer<typeof ProjectCronDailyScheduleSchema>
export type ProjectCronSchedule = z.infer<typeof ProjectCronScheduleSchema>
export type ProjectCronConfig = z.infer<typeof ProjectCronConfigSchema>
export type ProjectAgentToolFile = z.infer<typeof ProjectAgentToolFileSchema>
export type ProjectCronToolFile = z.infer<typeof ProjectCronToolFileSchema>
export type ProjectToolFile = z.infer<typeof ProjectToolFileSchema>
export type ProjectAgentListResponse = z.infer<typeof ProjectAgentListResponseSchema>
export type ProjectCronListResponse = z.infer<typeof ProjectCronListResponseSchema>
export type ProjectToolListResponse = z.infer<typeof ProjectToolListResponseSchema>
export type ProjectToolCounts = z.infer<typeof ProjectToolCountsSchema>
export type ProjectToolCountsRequest = z.infer<typeof ProjectToolCountsRequestSchema>
export type ProjectToolCountsResult = z.infer<typeof ProjectToolCountsResultSchema>
export type ProjectToolBatchCountsRequest = z.infer<typeof ProjectToolBatchCountsRequestSchema>
export type ProjectToolBatchCountsResponse = z.infer<typeof ProjectToolBatchCountsResponseSchema>
export type ProjectToolReadRequest = z.infer<typeof ProjectToolReadRequestSchema>
export type ProjectToolDeleteRequest = z.infer<typeof ProjectToolDeleteRequestSchema>
export type ProjectAgentWriteRequest = z.infer<typeof ProjectAgentWriteRequestSchema>
export type ProjectCronWriteRequest = z.infer<typeof ProjectCronWriteRequestSchema>
export type ProjectToolWriteRequest = z.infer<typeof ProjectToolWriteRequestSchema>
export type ProjectToolMutationResponse = z.infer<typeof ProjectToolMutationResponseSchema>
export type CronRunStatus = z.infer<typeof CronRunStatusSchema>
export type CronRunRecord = z.infer<typeof CronRunRecordSchema>
export type ProjectToolsUpdatedEvent = z.infer<typeof ProjectToolsUpdatedEventSchema>
export type CronRunUpdatedEvent = z.infer<typeof CronRunUpdatedEventSchema>
