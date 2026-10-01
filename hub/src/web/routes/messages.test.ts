import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMessagesRoutes } from './messages'

function createApp(opts?: {
    steerQueuedMessage?: (sessionId: string, messageId: string) => Promise<unknown>
    getQueuedState?: (sessionId: string, localIds: string[]) => unknown
    getTimelineSummary?: (sessionId: string, options: { limit?: number; beforeSeq?: number }) => unknown
    getTimelineDetails?: (sessionId: string, groupId: string) => unknown
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
        getTimelineSummary: opts?.getTimelineSummary ?? (() => ({
            items: [],
            page: { limit: 60, nextBeforeSeq: null, hasMore: false }
        })),
        getTimelineDetails: opts?.getTimelineDetails ?? (() => ({
            group: {
                id: 'work-group:1-2',
                kind: 'work-group',
                createdAt: 1000,
                seqStart: 1,
                seqEnd: 2,
                work: {}
            },
            messages: [],
            page: { limit: 10000, nextBeforeSeq: null, hasMore: false }
        })),
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

    it('returns the compact timeline with its cursor', async () => {
        let captured: { sessionId: string; options: { limit?: number; beforeSeq?: number } } | null = null
        const app = createApp({
            getTimelineSummary: (sessionId, options) => {
                captured = { sessionId, options }
                return {
                    items: [{
                        id: 'work-group:10-12',
                        kind: 'work-group',
                        createdAt: 1000,
                        seqStart: 10,
                        seqEnd: 12,
                        work: { toolCount: 2 }
                    }],
                    page: { limit: options.limit ?? 60, nextBeforeSeq: 10, hasMore: true }
                }
            }
        })

        const response = await app.request('/api/sessions/session-1/timeline?limit=20&beforeSeq=50')

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', options: { limit: 20, beforeSeq: 50 } })
        const body = await response.json() as { items: Array<{ id: string }> }
        expect(body.items[0].id).toBe('work-group:10-12')
    })

    it('routes a work-group detail request separately from the timeline', async () => {
        let captured: { sessionId: string; groupId: string } | null = null
        const app = createApp({
            getTimelineDetails: (sessionId, groupId) => {
                captured = { sessionId, groupId }
                return { group: { id: groupId }, messages: [{ id: 'message-1' }] }
            }
        })

        const response = await app.request('/api/sessions/session-1/timeline/work-group%3A10-12')

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', groupId: 'work-group:10-12' })
        const body = await response.json() as { group: { id: string } }
        expect(body.group.id).toBe('work-group:10-12')
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
