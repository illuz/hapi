import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import { PermissionModeSchema } from '@hapi/protocol/schemas'
import { getConfiguration } from '../../configuration'
import type { SyncEngine, SyncEvent } from '../../sync/syncEngine'
import type { Store, StoredSessionShare } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import {
    decryptShareToken,
    encryptShareToken,
    generateShareToken,
    hashSharePassword,
    hashShareToken,
    verifySharePassword
} from '../../utils/shareCrypto'

const createShareSchema = z.object({
    password: z.string().min(1).max(255),
    label: z.string().trim().max(120).nullable().optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
    includeHistory: z.boolean().optional()
})

const updateShareSchema = z.object({
    password: z.string().min(1).max(255).optional(),
    label: z.string().trim().max(120).nullable().optional(),
    expiresAt: z.number().int().positive().nullable().optional()
}).refine((value) => value.password !== undefined || value.label !== undefined || value.expiresAt !== undefined, {
    message: 'At least one field is required'
})

const shareAuthSchema = z.object({
    password: z.string().min(1).max(255)
})

const shareMessageSchema = z.object({
    text: z.string().min(1).max(20000),
    localId: z.string().min(1).optional()
})

const permissionDecisionSchema = z.enum(['approved', 'approved_for_session', 'denied', 'abort'])
const shareApproveBodySchema = z.object({
    mode: PermissionModeSchema.optional(),
    allowTools: z.array(z.string()).optional(),
    decision: permissionDecisionSchema.optional(),
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
})

const shareDenyBodySchema = z.object({
    decision: permissionDecisionSchema.optional()
})

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional(),
    byPosition: z.string().optional(),
    beforeAt: z.coerce.number().int().min(0).optional(),
})

type PublicShareEnv = WebAppEnv

type ShareStatus = 'active' | 'expired' | 'revoked'

function getShareStatus(share: StoredSessionShare, now: number = Date.now()): ShareStatus {
    if (share.revokedAt !== null) return 'revoked'
    if (share.expiresAt !== null && share.expiresAt <= now) return 'expired'
    return 'active'
}

function publicUrlForShare(rawToken: string): string {
    let base = ''
    try {
        base = getConfiguration().publicUrl?.replace(/\/$/, '') ?? ''
    } catch {
        base = ''
    }
    return `${base}/share/${encodeURIComponent(rawToken)}`
}

function serializeOwnerShare(share: StoredSessionShare, jwtSecret: Uint8Array, includeUrl = false) {
    const rawToken = includeUrl ? decryptShareToken(share.tokenEncrypted, jwtSecret) : null
    return {
        id: share.id,
        sessionId: share.sessionId,
        label: share.label,
        url: rawToken ? publicUrlForShare(rawToken) : undefined,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt,
        lastUsedAt: share.lastUsedAt,
        visibleFromSeq: share.visibleFromSeq,
        status: getShareStatus(share)
    }
}

function serializePublicShare(share: StoredSessionShare) {
    return {
        id: share.id,
        sessionId: share.sessionId,
        label: share.label,
        expiresAt: share.expiresAt,
        status: getShareStatus(share)
    }
}

function getBearerOrQueryToken(c: Context<PublicShareEnv>): string | null {
    const authorization = c.req.header('authorization')
    if (authorization?.startsWith('Bearer ')) {
        return authorization.slice('Bearer '.length)
    }
    const token = c.req.query('guestToken') ?? c.req.query('token')
    return token?.trim() || null
}

function getActiveShareByRouteToken(store: Store, token: string): StoredSessionShare | null {
    const share = store.sessionShares.getByTokenHash(hashShareToken(token))
    if (!share || getShareStatus(share) !== 'active') {
        return null
    }
    return share
}

function verifyGuestToken(store: Store, jwtSecret: Uint8Array, routeToken: string, guestToken: string | null): StoredSessionShare | null {
    if (!guestToken) return null
    const share = getActiveShareByRouteToken(store, routeToken)
    if (!share) return null
    const rawToken = decryptShareToken(guestToken, jwtSecret)
    if (!rawToken) return null
    if (hashShareToken(rawToken) !== share.tokenHash) return null
    return share
}

function filterSharedMessages<T extends { seq: number | null }>(messages: T[], visibleFromSeq: number): T[] {
    return messages.filter((message) => typeof message.seq === 'number' && message.seq > visibleFromSeq)
}

function filterShareEvent(event: SyncEvent, share: StoredSessionShare): SyncEvent | null {
    if ('sessionId' in event && event.sessionId !== share.sessionId) return null
    if (event.type === 'message-received') {
        if (typeof event.message.seq !== 'number' || event.message.seq <= share.visibleFromSeq) return null
        return event
    }
    if (event.type === 'messages-invalidated'
        || event.type === 'messages-consumed'
        || event.type === 'message-cancelled'
        || event.type === 'heartbeat'
        || event.type === 'connection-changed') {
        return event
    }
    if (event.type === 'session-updated') {
        const data = event.data && typeof event.data === 'object'
            ? event.data as Record<string, unknown>
            : {}
        return {
            type: 'session-updated',
            sessionId: event.sessionId,
            namespace: event.namespace,
            data: {
                active: data.active,
                thinking: data.thinking,
                updatedAt: data.updatedAt
            }
        }
    }
    return null
}

function guestPrompt(label: string | null): string {
    return [
        'This message comes from a shared guest session for requirements clarification.',
        label ? `Share label: ${label}` : null,
        'Focus only on clarifying product requirements and constraints.',
        'Do not modify files, run shell commands, use tools, or request permission approvals.',
        'Ask concise follow-up questions when requirements are ambiguous.',
        'When requirements are clear, summarize them and wait for the owner to continue.'
    ].filter(Boolean).join('\n')
}

export function createSessionShareRoutes(
    getSyncEngine: () => SyncEngine | null,
    store: Store,
    jwtSecret: Uint8Array
): Hono<PublicShareEnv> {
    const app = new Hono<PublicShareEnv>()

    app.get('/sessions/:id/shares', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const namespace = c.get('namespace')
        const shares = store.sessionShares.list(namespace, sessionResult.sessionId)
            .map((share) => serializeOwnerShare(share, jwtSecret, true))
        return c.json({ shares })
    })

    app.post('/sessions/:id/shares', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        if (sessionResult.session.permissionMode === 'bypassPermissions') {
            return c.json({ error: 'Cannot share sessions in bypassPermissions mode', code: 'unsafe_permission_mode' }, 409)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createShareSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const namespace = c.get('namespace')
        const rawToken = generateShareToken()
        const visibleFromSeq = parsed.data.includeHistory ? 0 : store.messages.getMaxSeq(sessionResult.sessionId)
        const share = store.sessionShares.create({
            namespace,
            sessionId: sessionResult.sessionId,
            tokenHash: hashShareToken(rawToken),
            tokenEncrypted: encryptShareToken(rawToken, jwtSecret),
            passwordHash: hashSharePassword(parsed.data.password),
            label: parsed.data.label ?? null,
            visibleFromSeq,
            expiresAt: parsed.data.expiresAt ?? null
        })
        engine.emitShareUpdated(sessionResult.sessionId, namespace)
        return c.json({ share: serializeOwnerShare(share, jwtSecret, true) }, 201)
    })

    app.patch('/sessions/:id/shares/:shareId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const body = await c.req.json().catch(() => null)
        const parsed = updateShareSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const namespace = c.get('namespace')
        const share = store.sessionShares.update(namespace, sessionResult.sessionId, c.req.param('shareId'), {
            label: parsed.data.label,
            expiresAt: parsed.data.expiresAt,
            passwordHash: parsed.data.password !== undefined ? hashSharePassword(parsed.data.password) : undefined
        })
        if (!share) return c.json({ error: 'Share not found' }, 404)
        engine.emitShareUpdated(sessionResult.sessionId, namespace)
        return c.json({ share: serializeOwnerShare(share, jwtSecret, true) })
    })

    app.post('/sessions/:id/shares/:shareId/revoke', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const namespace = c.get('namespace')
        const share = store.sessionShares.revoke(namespace, sessionResult.sessionId, c.req.param('shareId'))
        if (!share) return c.json({ error: 'Share not found' }, 404)
        engine.emitShareUpdated(sessionResult.sessionId, namespace)
        return c.json({ share: serializeOwnerShare(share, jwtSecret, true) })
    })

    app.post('/share/:token/auth', async (c) => {
        const rawToken = c.req.param('token')
        const share = getActiveShareByRouteToken(store, rawToken)
        if (!share) return c.json({ error: 'Share not found or inactive' }, 404)
        const body = await c.req.json().catch(() => null)
        const parsed = shareAuthSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        if (!verifySharePassword(parsed.data.password, share.passwordHash)) {
            return c.json({ error: 'Invalid password' }, 401)
        }
        store.sessionShares.touchLastUsed(share.id)
        return c.json({
            token: encryptShareToken(rawToken, jwtSecret),
            share: serializePublicShare(share)
        })
    })

    app.get('/share/:token/session', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const session = engine.getSessionByNamespace(share.sessionId, share.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        return c.json({
            share: serializePublicShare(share),
            session: {
                id: session.id,
                active: session.active,
                thinking: session.thinking,
                updatedAt: session.updatedAt,
                agentState: session.agentState,
                metadata: session.metadata ? {
                    name: session.metadata.name,
                    summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
                    flavor: session.metadata.flavor ?? null
                } : null
            }
        })
    })

    app.get('/share/:token/messages', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 200) : 200
        if (parsed.success && parsed.data.byPosition === '1') {
            const before = parsed.data.beforeAt !== undefined && parsed.data.beforeSeq !== undefined
                ? { at: parsed.data.beforeAt, seq: parsed.data.beforeSeq }
                : null
            const page = engine.getMessagesPageByPosition(share.sessionId, { limit, before })
            return c.json({ ...page, messages: filterSharedMessages(page.messages, share.visibleFromSeq) })
        }
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null
        const page = engine.getMessagesPage(share.sessionId, { limit, beforeSeq })
        return c.json({ ...page, messages: filterSharedMessages(page.messages, share.visibleFromSeq) })
    })

    app.post('/share/:token/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const session = engine.getSessionByNamespace(share.sessionId, share.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (!session.active) return c.json({ error: 'Session is inactive' }, 409)
        const body = await c.req.json().catch(() => null)
        const parsed = shareMessageSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        await engine.sendMessage(share.sessionId, {
            text: parsed.data.text,
            localId: parsed.data.localId,
            sentFrom: 'shared-guest',
            meta: {
                appendSystemPrompt: guestPrompt(share.label),
                shareId: share.id,
                shareLabel: share.label
            }
        })
        return c.json({ ok: true })
    })

    app.post('/share/:token/permissions/:requestId/approve', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const session = engine.getSessionByNamespace(share.sessionId, share.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (!session.active) return c.json({ error: 'Session is inactive' }, 409)

        const requestId = c.req.param('requestId')
        const requests = session.agentState?.requests ?? null
        if (!requests || !requests[requestId]) {
            return c.json({ error: 'Request not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = shareApproveBodySchema.safeParse(body ?? {})
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const mode = parsed.data.mode
        if (mode !== undefined) {
            const flavor = session.metadata?.flavor ?? 'claude'
            if (!isPermissionModeAllowedForFlavor(mode, flavor)) {
                return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
            }
        }

        await engine.approvePermission(session.id, requestId, mode, parsed.data.allowTools, parsed.data.decision, parsed.data.answers)
        return c.json({ ok: true })
    })

    app.post('/share/:token/permissions/:requestId/deny', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const session = engine.getSessionByNamespace(share.sessionId, share.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (!session.active) return c.json({ error: 'Session is inactive' }, 409)

        const requestId = c.req.param('requestId')
        const requests = session.agentState?.requests ?? null
        if (!requests || !requests[requestId]) {
            return c.json({ error: 'Request not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = shareDenyBodySchema.safeParse(body ?? {})
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        await engine.denyPermission(session.id, requestId, parsed.data.decision)
        return c.json({ ok: true })
    })

    app.post('/share/:token/complete', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)
        const session = engine.getSessionByNamespace(share.sessionId, share.namespace)
        if (!session) return c.json({ error: 'Session not found' }, 404)
        if (!session.active) return c.json({ error: 'Session is inactive' }, 409)
        await engine.sendMessage(share.sessionId, {
            text: '需求确认已完成。请总结已确认的需求，并等待 Owner 接手继续执行。',
            sentFrom: 'shared-guest',
            meta: {
                appendSystemPrompt: guestPrompt(share.label),
                shareId: share.id,
                shareLabel: share.label
            }
        })
        engine.emitShareCompleted(session.id, session.namespace, share.label)
        return c.json({ ok: true })
    })

    app.get('/share/:token/events', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const share = verifyGuestToken(store, jwtSecret, c.req.param('token'), getBearerOrQueryToken(c))
        if (!share) return c.json({ error: 'Share access denied' }, 401)

        const encoder = new TextEncoder()
        let unsubscribe: (() => void) | null = null
        const stream = new ReadableStream({
            start(controller) {
                const write = (event: unknown) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
                }
                write({ type: 'connection-changed', data: { status: 'connected' } })
                unsubscribe = engine.subscribe((event) => {
                    const filtered = filterShareEvent(event, share)
                    if (filtered) write(filtered)
                })
            },
            cancel() {
                unsubscribe?.()
                unsubscribe = null
            }
        })

        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')
        return c.body(stream)
    })

    return app
}
