import {
    ProjectAgentConfigSchema,
    ProjectCronConfigSchema,
    ProjectToolBatchCountsRequestSchema,
    ProjectToolIdSchema,
    ProjectToolKindSchema
} from '@hapi/protocol/projectTools'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSyncEngine } from './guards'

const projectPathQuerySchema = z.object({
    projectPath: z.string().trim().min(1)
})

const cronRunsQuerySchema = z.object({
    projectPath: z.string().trim().min(1).optional(),
    cronId: z.preprocess(
        (value) => typeof value === 'string' && value.length === 0 ? undefined : value,
        ProjectToolIdSchema.optional()
    ),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

const expectedHashQuerySchema = z.object({
    projectPath: z.string().trim().min(1),
    expectedHash: z.string().trim().min(1).nullable().optional()
})

const upsertBodySchema = z.object({
    projectPath: z.string().trim().min(1),
    config: z.unknown(),
    expectedHash: z.string().trim().min(1).nullable().optional()
})

function parseKind(value: string) {
    return ProjectToolKindSchema.safeParse(value)
}

function parseId(value: string) {
    return ProjectToolIdSchema.safeParse(value)
}

function toHttpStatus(result: { success?: boolean; error?: string } | { type: 'error'; code: string }): ContentfulStatusCode {
    const code = 'code' in result ? result.code : undefined
    if (code === 'agent_not_found' || code === 'cron_not_found') {
        return 404
    }
    if (
        code === 'agent_disabled'
        || code === 'cron_disabled'
        || code === 'invalid_permission_mode'
        || code === 'invalid_agent_config'
    ) {
        return 400
    }
    if (code) {
        return 502
    }

    const error = 'error' in result ? result.error : undefined
    if (typeof error === 'string' && /not found/i.test(error)) {
        return 404
    }
    if (typeof error === 'string' && /(invalid|hash mismatch)/i.test(error)) {
        return 400
    }
    return 502
}

export function createProjectToolsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines/:id/project-tools/:kind', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const kindParam = c.req.param('kind')
        if (kindParam === 'cron-runs') {
            const parsedQuery = cronRunsQuerySchema.safeParse({
                projectPath: c.req.query('projectPath'),
                cronId: c.req.query('cronId'),
                limit: c.req.query('limit')
            })
            if (!parsedQuery.success) {
                return c.json({ error: 'Invalid query' }, 400)
            }

            const runs = engine.listCronRuns({
                namespace: c.get('namespace'),
                machineId,
                projectPath: parsedQuery.data.projectPath,
                cronId: parsedQuery.data.cronId,
                limit: parsedQuery.data.limit
            })

            return c.json({ runs })
        }

        const parsedKind = parseKind(kindParam)
        if (!parsedKind.success) {
            return c.json({ error: 'Invalid project tool kind' }, 400)
        }

        const parsedQuery = projectPathQuerySchema.safeParse({
            projectPath: c.req.query('projectPath')
        })
        if (!parsedQuery.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const result = await engine.listProjectTools(machineId, parsedQuery.data.projectPath, parsedKind.data, c.get('namespace'))
        if (!result.success) {
            return c.json(result, toHttpStatus(result))
        }

        return c.json(result)
    })

    app.post('/project-tools/counts', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = ProjectToolBatchCountsRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        for (const project of parsed.data.projects) {
            const machine = requireMachine(c, engine, project.machineId)
            if (machine instanceof Response) {
                return machine
            }
        }

        const result = await engine.countProjectTools(parsed.data.projects, c.get('namespace'))
        return c.json(result)
    })

    app.post('/machines/:id/project-tools/:kind', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const parsedKind = parseKind(c.req.param('kind'))
        if (!parsedKind.success) {
            return c.json({ error: 'Invalid project tool kind' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsedBody = upsertBodySchema.safeParse(body)
        if (!parsedBody.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const parsedConfig = parsedKind.data === 'agent'
            ? ProjectAgentConfigSchema.safeParse(parsedBody.data.config)
            : ProjectCronConfigSchema.safeParse(parsedBody.data.config)
        if (!parsedConfig.success) {
            return c.json({ error: 'Invalid project tool config' }, 400)
        }

        const result = await engine.upsertProjectTool({
            machineId,
            namespace: c.get('namespace'),
            projectPath: parsedBody.data.projectPath,
            kind: parsedKind.data,
            id: parsedConfig.data.id,
            value: parsedConfig.data,
            expectedHash: parsedBody.data.expectedHash
        })
        if (!result.success) {
            return c.json(result, toHttpStatus(result))
        }

        return c.json(result)
    })

    app.delete('/machines/:id/project-tools/:kind/:toolId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const parsedKind = parseKind(c.req.param('kind'))
        const parsedId = parseId(c.req.param('toolId'))
        if (!parsedKind.success || !parsedId.success) {
            return c.json({ error: 'Invalid project tool path' }, 400)
        }

        const parsedQuery = expectedHashQuerySchema.safeParse({
            projectPath: c.req.query('projectPath'),
            expectedHash: c.req.query('expectedHash') ?? undefined
        })
        if (!parsedQuery.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const result = await engine.deleteProjectTool({
            machineId,
            namespace: c.get('namespace'),
            projectPath: parsedQuery.data.projectPath,
            kind: parsedKind.data,
            id: parsedId.data,
            expectedHash: parsedQuery.data.expectedHash
        })
        if (!result.success) {
            return c.json(result, toHttpStatus(result))
        }

        return c.json(result)
    })

    app.post('/machines/:id/project-tools/agents/:toolId/start', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const parsedId = parseId(c.req.param('toolId'))
        if (!parsedId.success) {
            return c.json({ error: 'Invalid project agent id' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsedBody = projectPathQuerySchema.safeParse(body)
        if (!parsedBody.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.startProjectAgent({
            machineId,
            namespace: c.get('namespace'),
            projectPath: parsedBody.data.projectPath,
            agentId: parsedId.data
        })
        if (result.type === 'error') {
            return c.json(result, toHttpStatus(result))
        }

        return c.json(result)
    })

    app.post('/machines/:id/project-tools/cron/:toolId/run', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const parsedId = parseId(c.req.param('toolId'))
        if (!parsedId.success) {
            return c.json({ error: 'Invalid project cron id' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsedBody = projectPathQuerySchema.safeParse(body)
        if (!parsedBody.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.triggerProjectCron({
            machineId,
            namespace: c.get('namespace'),
            projectPath: parsedBody.data.projectPath,
            cronId: parsedId.data
        })
        if (result.type === 'error') {
            return c.json(result, toHttpStatus(result))
        }

        return c.json(result)
    })

    return app
}
