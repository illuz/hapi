import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const historyQuerySchema = z.object({
    scope: z.enum(['session', 'project', 'all']).default('session'),
    sessionId: z.string().optional(),
    projectPath: z.string().optional(),
    q: z.string().optional(),
    userOnly: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    beforeCreatedAt: z.coerce.number().int().min(0).optional(),
    beforeId: z.string().optional()
})

export function createHistoryRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/history', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = historyQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const namespace = c.get('namespace')
        const { scope, sessionId, q, userOnly, limit, beforeCreatedAt, beforeId } = parsed.data
        let projectPath = parsed.data.projectPath ?? null

        if (scope === 'session') {
            if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)
            const access = engine.resolveSessionAccess(sessionId, namespace)
            if (!access.ok) {
                return c.json({ error: access.reason }, access.reason === 'not-found' ? 404 : 403)
            }
        }

        if (scope === 'project') {
            if (!projectPath && sessionId) {
                const access = engine.resolveSessionAccess(sessionId, namespace)
                if (!access.ok) {
                    return c.json({ error: access.reason }, access.reason === 'not-found' ? 404 : 403)
                }
                projectPath = access.session.metadata?.path ?? null
            }
            if (!projectPath) return c.json({ error: 'projectPath or sessionId is required' }, 400)
        }

        const before = beforeCreatedAt !== undefined && beforeId
            ? { createdAt: beforeCreatedAt, id: beforeId }
            : null

        return c.json(engine.searchConversationHistory({
            namespace,
            scope,
            sessionId: sessionId ?? null,
            projectPath,
            query: q ?? null,
            userOnly: userOnly === 'true',
            limit: limit ?? 50,
            before
        }))
    })

    return app
}
