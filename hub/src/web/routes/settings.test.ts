import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createSettingsRoutes } from './settings'

function createApp(namespace: string = 'default') {
    const store = new Store(':memory:')
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createSettingsRoutes(store))
    return { app, store }
}

describe('settings routes', () => {
    it('lists custom Codex models for the current namespace', async () => {
        const { app, store } = createApp()
        store.customCodexModels.upsert('default', { modelId: 'gpt-6-astra', displayName: 'GPT-6 Astra' })

        const response = await app.request('/api/settings/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            models: [{ id: 'gpt-6-astra', displayName: 'GPT-6 Astra' }]
        })
    })

    it('saves and updates a custom model', async () => {
        const { app } = createApp()

        const first = await app.request('/api/settings/codex-models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: 'gpt-6-astra',
                displayName: 'GPT-6 Astra',
                supportedReasoningEfforts: ['high', 'ultra']
            })
        })
        expect(first.status).toBe(200)

        const second = await app.request('/api/settings/codex-models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gpt-6-astra', displayName: 'Astra' })
        })
        expect(second.status).toBe(200)
        expect(await second.json()).toMatchObject({
            model: { id: 'gpt-6-astra', displayName: 'Astra', supportedReasoningEfforts: [] }
        })
    })

    it('rejects invalid IDs and removes models', async () => {
        const { app } = createApp()

        const invalid = await app.request('/api/settings/codex-models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gpt 6 astra' })
        })
        expect(invalid.status).toBe(400)

        await app.request('/api/settings/codex-models', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gpt-6-astra' })
        })
        const removed = await app.request('/api/settings/codex-models', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gpt-6-astra' })
        })
        expect(removed.status).toBe(200)

        const missing = await app.request('/api/settings/codex-models', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'gpt-6-astra' })
        })
        expect(missing.status).toBe(404)
    })
})
