import { z } from 'zod'

export const PORT_MAPPING_TOKEN_QUERY_PARAM = 'hapi_port_token'

const NonEmptyTrimmedStringSchema = z.string().trim().min(1)
const TimestampSchema = z.number().int().nonnegative()

export const PortMappingAliasSchema = z.string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, 'Port mapping alias can only contain letters, numbers, underscores, and hyphens')

export const PortMappingPortSchema = z.number().int().min(1).max(65535)
export const PortMappingDurationMsSchema = z.number().int().min(60_000).max(24 * 60 * 60_000)
export const PortMappingStatusSchema = z.enum(['active', 'disabled', 'expired'])
export const PortMappingTargetTypeSchema = z.enum(['port', 'static'])
export const PortMappingStaticPathSchema = z.string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => !/[\0\r\n]/.test(value), 'Static path cannot contain control characters')

export const PortMappingSchema = z.object({
    id: NonEmptyTrimmedStringSchema,
    namespace: NonEmptyTrimmedStringSchema.optional(),
    machineId: NonEmptyTrimmedStringSchema,
    projectPath: NonEmptyTrimmedStringSchema,
    alias: PortMappingAliasSchema,
    targetType: PortMappingTargetTypeSchema,
    port: PortMappingPortSchema.nullable(),
    targetHost: NonEmptyTrimmedStringSchema.nullable(),
    staticPath: PortMappingStaticPathSchema.nullable(),
    enabled: z.boolean(),
    status: PortMappingStatusSchema,
    durationMs: PortMappingDurationMsSchema,
    expiresAt: TimestampSchema.nullable(),
    lastEnabledAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    accessUrl: z.string().optional()
})

export const PortMappingListResponseSchema = z.object({
    mappings: z.array(PortMappingSchema)
})

export const PortMappingCreateRequestSchema = z.discriminatedUnion('targetType', [
    z.object({
        targetType: z.literal('port'),
        projectPath: NonEmptyTrimmedStringSchema,
        alias: PortMappingAliasSchema.optional(),
        port: PortMappingPortSchema,
        durationMs: PortMappingDurationMsSchema.optional()
    }),
    z.object({
        targetType: z.literal('static'),
        projectPath: NonEmptyTrimmedStringSchema,
        alias: PortMappingAliasSchema.optional(),
        staticPath: PortMappingStaticPathSchema,
        durationMs: PortMappingDurationMsSchema.optional()
    })
])

export const PortMappingUpdateRequestSchema = z.object({
    alias: PortMappingAliasSchema.optional(),
    port: PortMappingPortSchema.optional(),
    staticPath: PortMappingStaticPathSchema.optional(),
    durationMs: PortMappingDurationMsSchema.optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const PortMappingEnableRequestSchema = z.object({
    durationMs: PortMappingDurationMsSchema.optional()
}).optional()

export const PortMappingMutationResponseSchema = z.object({
    mapping: PortMappingSchema,
    accessUrl: z.string().optional()
})

export const PortMappingsUpdatedEventSchema = z.object({
    namespace: NonEmptyTrimmedStringSchema.optional(),
    machineId: NonEmptyTrimmedStringSchema,
    projectPath: NonEmptyTrimmedStringSchema,
    mappingId: NonEmptyTrimmedStringSchema.optional(),
    alias: PortMappingAliasSchema.optional(),
    targetType: PortMappingTargetTypeSchema.optional(),
    status: PortMappingStatusSchema.optional()
})

export const PortProxyFetchRequestSchema = z.object({
    port: PortMappingPortSchema,
    targetHost: NonEmptyTrimmedStringSchema.default('127.0.0.1'),
    method: NonEmptyTrimmedStringSchema,
    path: z.string().startsWith('/'),
    headers: z.record(z.string(), z.string()).optional(),
    bodyBase64: z.string().optional()
})

export const PortProxyFetchResponseSchema = z.discriminatedUnion('success', [
    z.object({
        success: z.literal(true),
        status: z.number().int().min(100).max(599),
        statusText: z.string().optional(),
        headers: z.record(z.string(), z.string()),
        bodyBase64: z.string().optional()
    }),
    z.object({
        success: z.literal(false),
        error: z.string()
    })
])

export const PortProxyCheckRequestSchema = z.object({
    port: PortMappingPortSchema,
    targetHost: NonEmptyTrimmedStringSchema.default('127.0.0.1')
})

export const PortProxyCheckResponseSchema = z.discriminatedUnion('success', [
    z.object({ success: z.literal(true) }),
    z.object({ success: z.literal(false), error: z.string() })
])

export const StaticSiteProxyFetchRequestSchema = z.object({
    projectPath: NonEmptyTrimmedStringSchema,
    staticPath: PortMappingStaticPathSchema,
    method: NonEmptyTrimmedStringSchema,
    path: z.string().startsWith('/'),
    headers: z.record(z.string(), z.string()).optional(),
    bodyBase64: z.string().optional()
})

export type PortMappingAlias = z.infer<typeof PortMappingAliasSchema>
export type PortMappingStatus = z.infer<typeof PortMappingStatusSchema>
export type PortMappingTargetType = z.infer<typeof PortMappingTargetTypeSchema>
export type PortMappingStaticPath = z.infer<typeof PortMappingStaticPathSchema>
export type PortMapping = z.infer<typeof PortMappingSchema>
export type PortMappingListResponse = z.infer<typeof PortMappingListResponseSchema>
export type PortMappingCreateRequest = z.infer<typeof PortMappingCreateRequestSchema>
export type PortMappingUpdateRequest = z.infer<typeof PortMappingUpdateRequestSchema>
export type PortMappingEnableRequest = z.infer<typeof PortMappingEnableRequestSchema>
export type PortMappingMutationResponse = z.infer<typeof PortMappingMutationResponseSchema>
export type PortMappingsUpdatedEvent = z.infer<typeof PortMappingsUpdatedEventSchema>
export type PortProxyFetchRequest = z.infer<typeof PortProxyFetchRequestSchema>
export type PortProxyFetchResponse = z.infer<typeof PortProxyFetchResponseSchema>
export type PortProxyCheckRequest = z.infer<typeof PortProxyCheckRequestSchema>
export type PortProxyCheckResponse = z.infer<typeof PortProxyCheckResponseSchema>
export type StaticSiteProxyFetchRequest = z.infer<typeof StaticSiteProxyFetchRequestSchema>
