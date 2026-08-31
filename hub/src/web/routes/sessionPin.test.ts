import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function createSession(): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: { path: '/tmp/project', host: 'localhost', flavor: 'codex' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        markerColor: null,
        pinned: false,
        model: null,
        modelReasoningEffort: null,
        serviceTier: null,
        effort: null
    }
}

function createApp() {
    const session = createSession()
    const calls: Array<[string, boolean]> = []
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
        setSessionPinned: async (sessionId: string, pinned: boolean) => {
            calls.push([sessionId, pinned])
        }
    } as unknown as SyncEngine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine))
    return { app, calls }
}

describe('session pin route', () => {
    it('pins and unpins a session through the patch endpoint', async () => {
        const { app, calls } = createApp()

        const pin = await app.request('/api/sessions/session-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pinned: true })
        })
        const unpin = await app.request('/api/sessions/session-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pinned: false })
        })

        expect(pin.status).toBe(200)
        expect(unpin.status).toBe(200)
        expect(calls).toEqual([
            ['session-1', true],
            ['session-1', false]
        ])
    })

    it('rejects an empty session patch', async () => {
        const { app, calls } = createApp()

        const response = await app.request('/api/sessions/session-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(400)
        expect(calls).toHaveLength(0)
    })
})
