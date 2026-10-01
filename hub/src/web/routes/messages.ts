import { Hono } from 'hono'
import { AttachmentMetadataSchema, QueuedStateRequestSchema } from '@hapi/protocol/schemas'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional(),
    byPosition: z.string().optional(),
    beforeAt: z.coerce.number().int().min(0).optional(),
    afterSeq: z.coerce.number().int().min(1).optional(),
    afterAt: z.coerce.number().int().min(0).optional(),
    untilSeq: z.coerce.number().int().min(1).optional(),
    untilAt: z.coerce.number().int().min(0).optional(),
    epoch: z.coerce.number().int().min(0).optional(),
})
    // 大纲跳转仍使用旧版的 seq-only 游标；复合游标必须同时提供位置和序号，
    // 但仅提供 beforeSeq 仍应保留给兼容路径使用。
    .refine((data) => data.beforeAt === undefined || data.beforeSeq !== undefined, {
        message: 'beforeAt and beforeSeq must be provided together',
        path: ['beforeAt']
    })
    .refine((data) => (data.afterAt === undefined) === (data.afterSeq === undefined), {
        message: 'afterAt and afterSeq must be provided together',
        path: ['afterAt']
    })
    .refine((data) => (data.untilAt === undefined) === (data.untilSeq === undefined), {
        message: 'untilAt and untilSeq must be provided together',
        path: ['untilAt']
    })
    .refine((data) => data.beforeAt === undefined || data.afterAt === undefined, {
        message: 'before and after cursors are mutually exclusive',
        path: ['afterAt']
    })
    .refine((data) => data.untilAt === undefined || data.afterAt !== undefined, {
        message: 'until cursor requires an after cursor',
        path: ['untilAt']
    })
    .refine((data) => data.epoch === undefined || data.afterAt !== undefined, {
        message: 'epoch requires an after cursor',
        path: ['epoch']
    })

const timelineQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const sendMessageBodySchema = z.object({
    text: z.string(),
    localId: z.string().min(1).optional(),
    attachments: z.array(AttachmentMetadataSchema).optional()
})

export function createMessagesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/outline', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        return c.json({ items: engine.getConversationOutline(sessionResult.sessionId) })
    })

    app.get('/sessions/:id/timeline', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const parsed = timelineQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query', issues: parsed.error.flatten() }, 400)
        }

        return c.json(engine.getTimelineSummary(sessionResult.sessionId, parsed.data))
    })

    app.get('/sessions/:id/timeline/:groupId', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            return c.json(engine.getTimelineDetails(sessionResult.sessionId, c.req.param('groupId')))
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Invalid timeline group'
            }, 400)
        }
    })

    app.get('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = querySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query', issues: parsed.error.flatten() }, 400)
        }
        const limit = parsed.data.limit ?? 200

        // Tail-sync clients use the composite cursor contract. A cursorless
        // request is also incremental's initial/latest page; retain the old
        // seq-only response only for legacy callers that explicitly send
        // `beforeSeq` without a display-position pair.
        const useIncremental = parsed.data.beforeAt !== undefined
            || parsed.data.afterAt !== undefined
            || parsed.data.untilAt !== undefined
            || parsed.data.epoch !== undefined
            || parsed.data.beforeSeq === undefined
        if (useIncremental) {
            const after = parsed.data.afterAt !== undefined && parsed.data.afterSeq !== undefined
                ? { at: parsed.data.afterAt, seq: parsed.data.afterSeq }
                : null
            const until = parsed.data.untilAt !== undefined && parsed.data.untilSeq !== undefined
                ? { at: parsed.data.untilAt, seq: parsed.data.untilSeq }
                : null
            const before = parsed.data.beforeAt !== undefined && parsed.data.beforeSeq !== undefined
                ? { at: parsed.data.beforeAt, seq: parsed.data.beforeSeq }
                : null
            return c.json(engine.getIncrementalMessagesPage(sessionId, {
                limit,
                before,
                after,
                until,
                epoch: parsed.data.epoch ?? null
            }))
        }

        // V8 byPosition mode: use composite (position_at, seq) cursor
        if (parsed.data.byPosition === '1') {
            const beforeAt = parsed.data.beforeAt
            const beforeSeq = parsed.data.beforeSeq
            const before = (beforeAt !== undefined && beforeSeq !== undefined)
                ? { at: beforeAt, seq: beforeSeq }
                : null
            return c.json(engine.getMessagesPageByPosition(sessionId, { limit, before }))
        }

        // V7-compatible path: seq-based cursor
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null
        return c.json(engine.getMessagesPage(sessionId, { limit, beforeSeq }))
    })

    app.post('/sessions/:id/messages/queued-state', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = QueuedStateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        return c.json(engine.getQueuedState(sessionResult.sessionId, [...new Set(parsed.data.localIds)]))
    })

    app.delete('/sessions/:id/messages/:messageId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId
        const messageId = c.req.param('messageId')

        const result = await engine.cancelQueuedMessage(sessionId, messageId)
        return c.json(result)
    })

    app.post('/sessions/:id/messages/:messageId/steer', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const result = await engine.steerQueuedMessage(
            sessionResult.sessionId,
            c.req.param('messageId')
        )
        return c.json(result)
    })

    app.post('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const body = await c.req.json().catch(() => null)
        const parsed = sendMessageBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // Require text or attachments
        if (!parsed.data.text && (!parsed.data.attachments || parsed.data.attachments.length === 0)) {
            return c.json({ error: 'Message requires text or attachments' }, 400)
        }

        await engine.sendMessage(sessionId, {
            text: parsed.data.text,
            localId: parsed.data.localId,
            attachments: parsed.data.attachments,
            sentFrom: 'webapp'
        })
        return c.json({ ok: true })
    })

    return app
}
