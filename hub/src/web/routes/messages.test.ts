import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMessagesRoutes } from './messages'

function createApp() {
    const engine = {
        resolveSessionAccess: () => ({
            ok: true,
            sessionId: 'session-1',
            session: { id: 'session-1', namespace: 'default' }
        }),
        getConversationOutline: () => ([
            {
                messageId: 'message-1',
                text: 'First turn',
                createdAt: 1000,
                seq: 1
            },
            {
                messageId: 'message-2',
                text: 'Second turn',
                createdAt: 2000,
                seq: 451
            }
        ])
    } as unknown as Partial<SyncEngine>
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createMessagesRoutes(() => engine as SyncEngine))
    return app
}

describe('messages routes', () => {
    it('returns the complete lightweight conversation outline', async () => {
        const response = await createApp().request('/api/sessions/session-1/outline')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            items: [
                {
                    messageId: 'message-1',
                    text: 'First turn',
                    createdAt: 1000,
                    seq: 1
                },
                {
                    messageId: 'message-2',
                    text: 'Second turn',
                    createdAt: 2000,
                    seq: 451
                }
            ]
        })
    })
})
