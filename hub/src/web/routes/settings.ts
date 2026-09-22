import { Hono } from 'hono'
import { z } from 'zod'

import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const modelIdSchema = z.string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/\s/.test(value), 'Model ID must not contain whitespace')

const customCodexModelSchema = z.object({
    id: modelIdSchema,
    displayName: z.string().trim().max(200).nullable().optional(),
    supportedReasoningEfforts: z.array(
        z.string().trim().min(1).max(64).refine((value) => !/\s/.test(value), 'Reasoning effort must not contain whitespace')
    ).max(20).optional()
})

const deleteCustomCodexModelSchema = z.object({
    id: modelIdSchema
})

const autoRetrySettingsSchema = z.object({
    enabled: z.boolean()
})

function toApiCustomCodexModel(model: {
    modelId: string
    displayName: string | null
    supportedReasoningEfforts: string[]
}) {
    return {
        id: model.modelId,
        displayName: model.displayName,
        supportedReasoningEfforts: model.supportedReasoningEfforts
    }
}

export function createSettingsRoutes(
    store: Store,
    getSyncEngine?: () => SyncEngine | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/settings/auto-retry', (c) => {
        const namespace = c.get('namespace')
        const engine = getSyncEngine?.()
        const enabled = engine
            ? engine.isAutoRetryEnabled(namespace)
            : store.namespaceSettings.get(namespace).autoRetryEnabled
        return c.json({ enabled })
    })

    app.post('/settings/auto-retry', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = autoRetrySettingsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        try {
            const engine = getSyncEngine?.()
            if (engine) {
                engine.setAutoRetryEnabled(namespace, parsed.data.enabled)
            } else {
                store.namespaceSettings.setAutoRetryEnabled(namespace, parsed.data.enabled)
            }
            return c.json({ enabled: parsed.data.enabled })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to update AUTO'
            }, 500)
        }
    })

    app.get('/settings/codex-models', (c) => {
        const models = store.customCodexModels.list(c.get('namespace')).map(toApiCustomCodexModel)
        return c.json({ models })
    })

    app.post('/settings/codex-models', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = customCodexModelSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const model = store.customCodexModels.upsert(c.get('namespace'), {
                modelId: parsed.data.id,
                displayName: parsed.data.displayName,
                supportedReasoningEfforts: parsed.data.supportedReasoningEfforts
            })
            return c.json({ model: toApiCustomCodexModel(model) })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to save custom Codex model'
            }, 500)
        }
    })

    app.delete('/settings/codex-models', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = deleteCustomCodexModelSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const removed = store.customCodexModels.remove(c.get('namespace'), parsed.data.id)
        if (!removed) {
            return c.json({ error: 'Custom Codex model not found' }, 404)
        }
        return c.json({ ok: true })
    })

    return app
}
