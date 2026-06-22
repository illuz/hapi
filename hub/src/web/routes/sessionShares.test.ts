import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine, SyncEventListener } from '../../sync/syncEngine'
import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionShareRoutes } from './sessionShares'

type SentMessage = Parameters<SyncEngine['sendMessage']>[1] & { sessionId: string }

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/shared-project',
        host: 'localhost',
        name: 'Shared Requirement Session',
        flavor: 'codex' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 10,
        active: true,
        activeAt: 10,
        metadata: baseMetadata,
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 10,
        markerColor: null,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
        serviceTier: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default'
    }
    return {
        ...base,
        ...overrides,
        metadata: overrides?.metadata === undefined
            ? base.metadata
            : overrides.metadata === null
                ? null
                : { ...baseMetadata, ...overrides.metadata },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function createApp(session: Session = createSession()) {
    const store = new Store(':memory:')
    const stored = store.sessions.getOrCreateSession(
        session.id,
        session.metadata,
        session.agentState,
        session.namespace,
        session.model ?? undefined,
        session.effort ?? undefined,
        session.modelReasoningEffort ?? undefined,
        session.serviceTier ?? undefined
    )
    const sessionId = stored.id
    if (session.permissionMode) {
        store.sessions.setSessionPermissionMode(sessionId, session.permissionMode, session.namespace)
    }
    const events: Array<{ sessionId: string; namespace: string }> = []
    const sentMessages: SentMessage[] = []
    const listeners = new Set<SyncEventListener>()
    const resolveStoredSession = () => {
        const current = store.sessions.getSessionByNamespace(sessionId, session.namespace)
        return current ? { ...current, ...session, id: sessionId, namespace: session.namespace, permissionMode: current.permissionMode ?? session.permissionMode } : undefined
    }
    const engine = {
        resolveSessionAccess: (candidateSessionId: string, namespace: string) => {
            if (candidateSessionId !== sessionId || namespace !== session.namespace) {
                return { ok: false, reason: 'not-found' }
            }
            const current = resolveStoredSession()
            if (!current) return { ok: false, reason: 'not-found' }
            return { ok: true, sessionId, session: current }
        },
        getSessionByNamespace: (candidateSessionId: string, namespace: string) => {
            if (candidateSessionId !== sessionId || namespace !== session.namespace) return undefined
            return resolveStoredSession()
        },
        getMessagesPage: (candidateSessionId: string, options: { limit: number; beforeSeq?: number | null }) => {
            const messages = store.messages.getMessages(candidateSessionId, options.limit, options.beforeSeq ?? undefined)
            return {
                messages: messages.map((message) => ({
                    id: message.id,
                    seq: message.seq,
                    localId: message.localId,
                    content: message.content,
                    createdAt: message.createdAt,
                    invokedAt: message.invokedAt
                })),
                page: {
                    limit: options.limit,
                    beforeSeq: options.beforeSeq ?? null,
                    nextBeforeSeq: null,
                    hasMore: false
                }
            }
        },
        getMessagesPageByPosition: (candidateSessionId: string, options: { limit: number; before?: { at: number; seq: number } | null }) => {
            const messages = store.messages.getMessagesByPosition(candidateSessionId, options.limit, options.before ?? undefined)
            return {
                messages: messages.map((message) => ({
                    id: message.id,
                    seq: message.seq,
                    localId: message.localId,
                    content: message.content,
                    createdAt: message.createdAt,
                    invokedAt: message.invokedAt
                })),
                page: {
                    limit: options.limit,
                    nextBeforeSeq: null,
                    nextBeforeAt: null,
                    hasMore: false
                }
            }
        },
        sendMessage: async (candidateSessionId: string, payload: Parameters<SyncEngine['sendMessage']>[1]) => {
            sentMessages.push({ sessionId: candidateSessionId, ...payload })
            store.messages.addMessage(candidateSessionId, {
                role: 'user',
                content: { type: 'text', text: payload.text },
                meta: {
                    ...payload.meta,
                    sentFrom: payload.sentFrom ?? 'webapp'
                }
            }, payload.localId ?? undefined)
        },
        emitShareUpdated: (candidateSessionId: string, namespace: string) => {
            events.push({ sessionId: candidateSessionId, namespace })
        },
        subscribe: (listener: SyncEventListener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        }
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionShareRoutes(() => engine as SyncEngine, store, new TextEncoder().encode('test-secret')))
    return { app, store, sentMessages, events, sessionId }
}

async function createShare(app: Hono<WebAppEnv>, sessionId: string, body?: Record<string, unknown>) {
    const response = await app.request(`/api/sessions/${sessionId}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            password: 'guest-pass',
            label: 'PM review',
            includeHistory: false,
            ...body
        })
    })
    expect(response.status).toBe(201)
    return await response.json() as { share: { id: string; url: string; visibleFromSeq: number; status: string } }
}

function tokenFromShareUrl(url: string): string {
    const parsed = new URL(url, 'http://localhost')
    return decodeURIComponent(parsed.pathname.replace(/^\/share\//, ''))
}

describe('session share routes', () => {
    it('creates password-protected shares, authenticates guests, filters history, sends guest messages, and revokes access', async () => {
        const { app, store, sentMessages, events, sessionId } = createApp()
        store.messages.addMessage(sessionId, { role: 'user', content: { type: 'text', text: 'old requirement' } })

        const created = await createShare(app, sessionId)
        expect(created.share.status).toBe('active')
        expect(created.share.url).toContain('/share/')
        expect(created.share.visibleFromSeq).toBe(1)
        expect(events).toEqual([{ sessionId, namespace: 'default' }])

        store.messages.addMessage(sessionId, { role: 'agent', content: 'new clarification' })
        const routeToken = tokenFromShareUrl(created.share.url)

        const badAuth = await app.request(`/api/share/${encodeURIComponent(routeToken)}/auth`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' })
        })
        expect(badAuth.status).toBe(401)

        const auth = await app.request(`/api/share/${encodeURIComponent(routeToken)}/auth`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'guest-pass' })
        })
        expect(auth.status).toBe(200)
        const authBody = await auth.json() as { token: string; share: { id: string; label: string } }
        expect(authBody.share.id).toBe(created.share.id)
        expect(authBody.share.label).toBe('PM review')

        const messages = await app.request(`/api/share/${encodeURIComponent(routeToken)}/messages`, {
            headers: { authorization: `Bearer ${authBody.token}` }
        })
        expect(messages.status).toBe(200)
        const messagesBody = await messages.json() as { messages: Array<{ seq: number; content: unknown }> }
        expect(messagesBody.messages.map((message) => message.seq)).toEqual([2])

        const send = await app.request(`/api/share/${encodeURIComponent(routeToken)}/messages`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${authBody.token}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ text: '用户确认：MVP 只需要 A 和 B', localId: 'guest-1' })
        })
        expect(send.status).toBe(200)
        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]).toMatchObject({
            sessionId,
            text: '用户确认：MVP 只需要 A 和 B',
            localId: 'guest-1',
            sentFrom: 'shared-guest'
        })
        expect(sentMessages[0]?.meta?.shareId).toBe(created.share.id)
        expect(sentMessages[0]?.meta?.shareLabel).toBe('PM review')
        expect(sentMessages[0]?.meta?.appendSystemPrompt).toContain('requirements clarification')

        const revoke = await app.request(`/api/sessions/${sessionId}/shares/${created.share.id}/revoke`, { method: 'POST' })
        expect(revoke.status).toBe(200)

        const afterRevoke = await app.request(`/api/share/${encodeURIComponent(routeToken)}/session`, {
            headers: { authorization: `Bearer ${authBody.token}` }
        })
        expect(afterRevoke.status).toBe(401)
    })

    it('rejects creating shares for bypassPermissions sessions', async () => {
        const { app, sessionId } = createApp(createSession({ permissionMode: 'bypassPermissions' }))
        const response = await app.request(`/api/sessions/${sessionId}/shares`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'guest-pass' })
        })
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Cannot share sessions in bypassPermissions mode',
            code: 'unsafe_permission_mode'
        })
    })
})
