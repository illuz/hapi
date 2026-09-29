import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMessagesRoutes } from './messages'

function createApp(opts?: {
    steerQueuedMessage?: (sessionId: string, messageId: string) => Promise<unknown>
    getQueuedState?: (sessionId: string, localIds: string[]) => unknown
}) {
    const engine = {
        resolveSessionAccess: () => ({
            ok: true,
            sessionId: 'session-1',
            session: { id: 'session-1', namespace: 'default', active: true }
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
        ]),
        getIncrementalMessagesPage: (_sessionId: string, options: { limit?: number }) => ({
            messages: [],
            page: {
                direction: 'latest',
                limit: options.limit ?? 20,
                epoch: 0,
                reset: false,
                nextBeforeSeq: null,
                nextBeforeAt: null,
                nextAfterSeq: null,
                nextAfterAt: null,
                snapshotHeadSeq: null,
                snapshotHeadAt: null,
                hasMore: false,
                receivedOptions: options
            }
        }),
        steerQueuedMessage: opts?.steerQueuedMessage ?? (async () => ({
            status: 'failed',
            error: 'Steer failed',
            localId: null
        })),
        getQueuedState: opts?.getQueuedState ?? (() => ({ queuedLocalIds: [], invokedLocalMessages: [] }))
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

    it('accepts a tail cursor and routes it to incremental pagination', async () => {
        const response = await createApp().request(
            '/api/sessions/session-1/messages?afterAt=100&afterSeq=4&epoch=2&limit=10'
        )

        expect(response.status).toBe(200)
        const body = await response.json() as { page: { direction: string; limit: number } }
        expect(body.page.direction).toBe('latest')
        expect(body.page.limit).toBe(10)
    })

    it('rejects incomplete composite cursors', async () => {
        const response = await createApp().request('/api/sessions/session-1/messages?afterSeq=4')
        expect(response.status).toBe(400)
    })

    it('forwards queued-message steer to the sync engine', async () => {
        let captured: { sessionId: string; messageId: string } | null = null
        const app = createApp({
            steerQueuedMessage: async (sessionId, messageId) => {
                captured = { sessionId, messageId }
                return { status: 'steered', localId: 'local-1' }
            }
        })

        const response = await app.request('/api/sessions/session-1/messages/message-1/steer', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', messageId: 'message-1' })
        expect(await response.json()).toEqual({ status: 'steered', localId: 'local-1' })
    })

    it('returns authoritative queued state for requested local ids', async () => {
        let captured: { sessionId: string; localIds: string[] } | null = null
        const app = createApp({
            getQueuedState: (sessionId, localIds) => {
                captured = { sessionId, localIds }
                return {
                    queuedLocalIds: ['local-1'],
                    invokedLocalMessages: [{ localId: 'local-2', invokedAt: 123 }]
                }
            }
        })

        const response = await app.request('/api/sessions/session-1/messages/queued-state', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ localIds: ['local-1', 'local-1', 'local-2'] })
        })

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', localIds: ['local-1', 'local-2'] })
        expect(await response.json()).toEqual({
            queuedLocalIds: ['local-1'],
            invokedLocalMessages: [{ localId: 'local-2', invokedAt: 123 }]
        })
    })
})
