import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSettingsRoutes } from './settings'

function createApp(namespace: string = 'default', getSyncEngine?: () => SyncEngine | null) {
    const store = new Store(':memory:')
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createSettingsRoutes(store, getSyncEngine))
    return { app, store }
}

describe('settings routes', () => {
    it('reads and updates the namespace-wide AUTO setting', async () => {
        const { app } = createApp('alpha')

        const initial = await app.request('/api/settings/auto-retry')
        expect(initial.status).toBe(200)
        expect(await initial.json()).toEqual({ enabled: false })

        const updated = await app.request('/api/settings/auto-retry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true })
        })
        expect(updated.status).toBe(200)
        expect(await updated.json()).toEqual({ enabled: true })

        const persisted = await app.request('/api/settings/auto-retry')
        expect(await persisted.json()).toEqual({ enabled: true })

        const otherNamespace = createApp('beta')
        const isolated = await otherNamespace.app.request('/api/settings/auto-retry')
        expect(await isolated.json()).toEqual({ enabled: false })
    })

    it('rejects invalid AUTO settings', async () => {
        const { app } = createApp()
        const response = await app.request('/api/settings/auto-retry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: 'yes' })
        })
        expect(response.status).toBe(400)
    })

    it('updates AUTO through the sync engine so live sessions are notified', async () => {
        let enabled = false
        const calls: Array<{ namespace: string; enabled: boolean }> = []
        const engine = {
            isAutoRetryEnabled: () => enabled,
            setAutoRetryEnabled: (namespace: string, nextEnabled: boolean) => {
                calls.push({ namespace, enabled: nextEnabled })
                enabled = nextEnabled
            }
        } as unknown as SyncEngine
        const { app } = createApp('alpha', () => engine)

        const response = await app.request('/api/settings/auto-retry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true })
        })

        expect(response.status).toBe(200)
        expect(calls).toEqual([{ namespace: 'alpha', enabled: true }])
        expect(await (await app.request('/api/settings/auto-retry')).json()).toEqual({ enabled: true })
    })

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
