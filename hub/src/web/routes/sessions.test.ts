import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'codex' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: baseMetadata,
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        markerColor: null,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
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
                : {
                    ...baseMetadata,
                    ...overrides.metadata
                },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function createApp(session: Session, opts?: {
    resumeSession?: (sessionId: string, namespace: string, resumeOpts?: { permissionMode?: string }) => Promise<{ type: string; sessionId?: string; message?: string; code?: string }>
    spawnSessionFromConfig?: (sessionId: string, namespace: string, options?: { agent?: 'claude' | 'codex' }) => Promise<{ type: string; sessionId?: string; message?: string; code?: string }>
    forkSession?: (sessionId: string, namespace: string, options?: { rollbackTurns?: number; resumeSessionAt?: string }) => Promise<{ type: string; sessionId?: string; message?: string; code?: string }>
    resolveSessionAccess?: SyncEngine['resolveSessionAccess']
    archiveSession?: (sessionId: string) => Promise<void>
    deleteSession?: (sessionId: string) => Promise<void>
    listSlashCommands?: SyncEngine['listSlashCommands']
}) {
    const applySessionConfigCalls: Array<[string, Record<string, unknown>]> = []
    const renameSessionCalls: Array<[string, string]> = []
    const setSessionMarkerColorCalls: Array<[string, Session['markerColor']]> = []
    const archiveSessionCalls: string[] = []
    const deleteSessionCalls: string[] = []
    const applySessionConfig = async (sessionId: string, config: Record<string, unknown>) => {
        applySessionConfigCalls.push([sessionId, config])
    }
    const renameSession = async (sessionId: string, name: string) => {
        renameSessionCalls.push([sessionId, name])
    }
    const setSessionMarkerColor = async (sessionId: string, markerColor: Session['markerColor']) => {
        setSessionMarkerColorCalls.push([sessionId, markerColor])
    }
    const listCodexModelsForSession = async () => ({
        success: true,
        models: [
            { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
        ]
    })
    const listOpencodeModelsForSession = async () => ({
        success: true,
        availableModels: [
            { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
            { modelId: 'mlx/qwen3:0.6b', name: 'MLX/Qwen3 0.6B' }
        ],
        currentModelId: 'ollama/exaone:4.5-33b-q8'
    })
    const resumeSession = opts?.resumeSession ?? (async (sessionId: string) => ({ type: 'success', sessionId }))
    const spawnSessionFromConfig = opts?.spawnSessionFromConfig ?? (async (sessionId: string) => ({ type: 'success', sessionId }))
    const forkSession = opts?.forkSession ?? (async (sessionId: string) => ({ type: 'success', sessionId }))
    const archiveSession = opts?.archiveSession ?? (async (sessionId: string) => {
        archiveSessionCalls.push(sessionId)
    })
    const deleteSession = opts?.deleteSession ?? (async (sessionId: string) => {
        deleteSessionCalls.push(sessionId)
    })
    const engine = {
        resolveSessionAccess: opts?.resolveSessionAccess ?? (() => ({ ok: true, sessionId: session.id, session })),
        applySessionConfig,
        renameSession,
        setSessionMarkerColor,
        listCodexModelsForSession,
        listOpencodeModelsForSession,
        resumeSession,
        spawnSessionFromConfig,
        forkSession,
        archiveSession,
        deleteSession,
        listSlashCommands: opts?.listSlashCommands ?? (async () => ({
            success: true,
            commands: []
        }))
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

    return {
        app,
        applySessionConfigCalls,
        renameSessionCalls,
        setSessionMarkerColorCalls,
        archiveSessionCalls,
        deleteSessionCalls
    }
}

describe('sessions routes', () => {
    it('spawns a new session from stored config', async () => {
        let captured: { sessionId: string; namespace: string; agent?: 'claude' | 'codex' } | null = null
        const { app } = createApp(createSession(), {
            spawnSessionFromConfig: async (sessionId, namespace, options) => {
                captured = { sessionId, namespace, agent: options?.agent }
                return { type: 'success', sessionId: 'session-new' }
            }
        })

        const response = await app.request('/api/sessions/session-1/spawn-from-config', {
            method: 'POST',
            body: JSON.stringify({ agent: 'claude' })
        })

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', namespace: 'default', agent: 'claude' })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'session-new' })
    })

    it('returns 409 when spawn-from-config is unavailable', async () => {
        const { app } = createApp(createSession(), {
            spawnSessionFromConfig: async () => ({
                type: 'error',
                message: 'Session metadata missing path',
                code: 'spawn_unavailable'
            })
        })

        const response = await app.request('/api/sessions/session-1/spawn-from-config', {
            method: 'POST'
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Session metadata missing path',
            code: 'spawn_unavailable'
        })
    })

    it('forks a session and forwards rollbackTurns', async () => {
        let captured: { sessionId: string; namespace: string; rollbackTurns?: number; resumeSessionAt?: string } | null = null
        const { app } = createApp(createSession(), {
            forkSession: async (sessionId, namespace, options) => {
                captured = {
                    sessionId,
                    namespace,
                    rollbackTurns: options?.rollbackTurns,
                    resumeSessionAt: options?.resumeSessionAt
                }
                return { type: 'success', sessionId: 'session-forked' }
            }
        })

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rollbackTurns: 2 })
        })

        expect(response.status).toBe(200)
        expect(captured!).toEqual({ sessionId: 'session-1', namespace: 'default', rollbackTurns: 2, resumeSessionAt: undefined })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'session-forked' })
    })

    it('forks a session and forwards resumeSessionAt', async () => {
        let captured: { sessionId: string; namespace: string; rollbackTurns?: number; resumeSessionAt?: string } | null = null
        const { app } = createApp(createSession(), {
            forkSession: async (sessionId, namespace, options) => {
                captured = {
                    sessionId,
                    namespace,
                    rollbackTurns: options?.rollbackTurns,
                    resumeSessionAt: options?.resumeSessionAt
                }
                return { type: 'success', sessionId: 'session-forked' }
            }
        })

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resumeSessionAt: 'assistant-uuid-1' })
        })

        expect(response.status).toBe(200)
        expect(captured!).toEqual({
            sessionId: 'session-1',
            namespace: 'default',
            rollbackTurns: undefined,
            resumeSessionAt: 'assistant-uuid-1'
        })
        expect(await response.json()).toEqual({ type: 'success', sessionId: 'session-forked' })
    })

    it('rejects invalid fork body', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rollbackTurns: -1 })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })

    it('returns 400 when fork is unsupported for the session flavor', async () => {
        const { app } = createApp(createSession(), {
            forkSession: async () => ({
                type: 'error',
                message: 'Fork is only supported for Codex sessions',
                code: 'unsupported_session_flavor'
            })
        })

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST'
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Fork is only supported for Codex sessions',
            code: 'unsupported_session_flavor'
        })
    })

    it('rejects collaboration mode changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects collaboration mode changes for non-Codex sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode is only supported for Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies collaboration mode changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { collaborationMode: 'plan' }]
        ])
    })

    it('rejects model reasoning effort changes for non-Codex sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort is only supported for Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects model reasoning effort changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model reasoning effort changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'xhigh' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { modelReasoningEffort: 'xhigh' }]
        ])
    })

    it('applies model and model reasoning effort together for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.6-sol', modelReasoningEffort: 'ultra' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gpt-5.6-sol', modelReasoningEffort: 'ultra' }]
        ])
    })

    it('applies model changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.5' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gpt-5.5' }]
        ])
    })

    it('rejects model changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.5' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model selection can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model changes for OpenCode sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'opencode'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'ollama/exaone:4.5-33b-q8' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'ollama/exaone:4.5-33b-q8' }]
        ])
    })

    it('applies model changes for Gemini sessions (regression: opencode addition does not break Gemini)', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'gemini'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-2.5-pro' })
        })

        expect(response.status).toBe(200)
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gemini-2.5-pro' }]
        ])
    })

    it('rejects model changes for Cursor sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'cursor'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'sonnet' })
        })

        expect(response.status).toBe(400)
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects effort changes for non-Claude sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Effort selection is only supported for Claude sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies effort changes for Claude sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'max' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { effort: 'max' }]
        ])
    })

    it('archives active sessions in bulk and skips inactive ones', async () => {
        const activeSession = createSession({ id: 'active-session', active: true })
        const inactiveSession = createSession({ id: 'inactive-session', active: false })
        const { app, archiveSessionCalls } = createApp(activeSession, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (namespace !== 'default') {
                    return { ok: false, reason: 'access-denied' }
                }
                if (sessionId === activeSession.id) {
                    return { ok: true, sessionId, session: activeSession }
                }
                if (sessionId === inactiveSession.id) {
                    return { ok: true, sessionId, session: inactiveSession }
                }
                return { ok: false, reason: 'not-found' }
            }
        })

        const response = await app.request('/api/sessions/bulk/archive', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [activeSession.id, inactiveSession.id]
            })
        })

        expect(response.status).toBe(200)
        expect(archiveSessionCalls).toEqual([activeSession.id])
        expect(await response.json()).toEqual({
            successIds: [activeSession.id],
            skipped: [
                {
                    sessionId: inactiveSession.id,
                    reason: 'session_inactive'
                }
            ],
            failed: []
        })
    })

    it('reports bulk archive failures and missing sessions', async () => {
        const activeSession = createSession({ id: 'active-session', active: true })
        const { app, archiveSessionCalls } = createApp(activeSession, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (namespace !== 'default') {
                    return { ok: false, reason: 'access-denied' }
                }
                if (sessionId === activeSession.id) {
                    return { ok: true, sessionId, session: activeSession }
                }
                return { ok: false, reason: 'not-found' }
            },
            archiveSession: async (sessionId) => {
                archiveSessionCalls.push(sessionId)
                throw new Error('RPC unavailable')
            }
        })

        const response = await app.request('/api/sessions/bulk/archive', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [activeSession.id, 'missing-session']
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            successIds: [],
            skipped: [],
            failed: [
                {
                    sessionId: activeSession.id,
                    error: 'RPC unavailable'
                },
                {
                    sessionId: 'missing-session',
                    error: 'Session not found'
                }
            ]
        })
    })

    it('rejects invalid bulk archive body', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/bulk/archive', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionIds: [''] })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })

    it('deletes inactive sessions in bulk and skips active ones', async () => {
        const activeSession = createSession({ id: 'active-session', active: true })
        const inactiveSession = createSession({ id: 'inactive-session', active: false })
        const { app, deleteSessionCalls } = createApp(inactiveSession, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (namespace !== 'default') {
                    return { ok: false, reason: 'access-denied' }
                }
                if (sessionId === activeSession.id) {
                    return { ok: true, sessionId, session: activeSession }
                }
                if (sessionId === inactiveSession.id) {
                    return { ok: true, sessionId, session: inactiveSession }
                }
                return { ok: false, reason: 'not-found' }
            }
        })

        const response = await app.request('/api/sessions/bulk/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [inactiveSession.id, activeSession.id]
            })
        })

        expect(response.status).toBe(200)
        expect(deleteSessionCalls).toEqual([inactiveSession.id])
        expect(await response.json()).toEqual({
            successIds: [inactiveSession.id],
            skipped: [
                {
                    sessionId: activeSession.id,
                    reason: 'session_active'
                }
            ],
            failed: []
        })
    })

    it('reports bulk delete failures and access denied sessions', async () => {
        const inactiveSession = createSession({ id: 'inactive-session', active: false })
        const { app, deleteSessionCalls } = createApp(inactiveSession, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (sessionId === inactiveSession.id && namespace === 'default') {
                    return { ok: true, sessionId, session: inactiveSession }
                }
                return { ok: false, reason: 'access-denied' }
            },
            deleteSession: async (sessionId) => {
                deleteSessionCalls.push(sessionId)
                throw new Error('Delete failed')
            }
        })

        const response = await app.request('/api/sessions/bulk/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [inactiveSession.id, 'forbidden-session']
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            successIds: [],
            skipped: [],
            failed: [
                {
                    sessionId: inactiveSession.id,
                    error: 'Delete failed'
                },
                {
                    sessionId: 'forbidden-session',
                    error: 'Session access denied'
                }
            ]
        })
    })

    it('rejects invalid bulk delete body', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/bulk/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })

    it('sets marker color in bulk and skips missing sessions', async () => {
        const coloredSession = createSession({ id: 'colored-session', markerColor: 'red' })
        const { app, setSessionMarkerColorCalls } = createApp(coloredSession, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (namespace !== 'default') {
                    return { ok: false, reason: 'access-denied' }
                }
                if (sessionId === coloredSession.id) {
                    return { ok: true, sessionId, session: coloredSession }
                }
                return { ok: false, reason: 'not-found' }
            }
        })

        const response = await app.request('/api/sessions/bulk/marker-color', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [coloredSession.id, 'missing-session'],
                markerColor: 'yellow'
            })
        })

        expect(response.status).toBe(200)
        expect(setSessionMarkerColorCalls).toEqual([
            ['colored-session', 'yellow']
        ])
        expect(await response.json()).toEqual({
            successIds: [coloredSession.id],
            failed: [
                {
                    sessionId: 'missing-session',
                    error: 'Session not found'
                }
            ]
        })
    })

    it('clears marker color in bulk', async () => {
        const session = createSession({ id: 'session-1', markerColor: 'blue' })
        const { app, setSessionMarkerColorCalls } = createApp(session, {
            resolveSessionAccess: (sessionId, namespace) => {
                if (namespace !== 'default') {
                    return { ok: false, reason: 'access-denied' }
                }
                if (sessionId === session.id) {
                    return { ok: true, sessionId, session }
                }
                return { ok: false, reason: 'not-found' }
            }
        })

        const response = await app.request('/api/sessions/bulk/marker-color', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                sessionIds: [session.id],
                markerColor: null
            })
        })

        expect(response.status).toBe(200)
        expect(setSessionMarkerColorCalls).toEqual([
            ['session-1', null]
        ])
        expect(await response.json()).toEqual({
            successIds: [session.id],
            failed: []
        })
    })

    it('rejects invalid bulk marker color body', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/bulk/marker-color', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionIds: ['session-1'] })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })

    it('updates marker color through patch session route', async () => {
        const { app, setSessionMarkerColorCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ markerColor: 'yellow' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(setSessionMarkerColorCalls).toEqual([
            ['session-1', 'yellow']
        ])
    })

    it('updates name through patch session route', async () => {
        const { app, renameSessionCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed session' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(renameSessionCalls).toEqual([
            ['session-1', 'Renamed session']
        ])
    })

    it('returns Codex models for active Codex sessions', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            models: [
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        })
    })

    it('returns OpenCode models for active OpenCode sessions', async () => {
        const session = createSession({
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }
        })
        const { app } = createApp(session)

        const response = await app.request('/api/sessions/session-1/opencode-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            availableModels: [
                { modelId: 'ollama/exaone:4.5-33b-q8', name: 'Ollama (SER8)/EXAONE 4.5 33B Q8' },
                { modelId: 'mlx/qwen3:0.6b', name: 'MLX/Qwen3 0.6B' }
            ],
            currentModelId: 'ollama/exaone:4.5-33b-q8'
        })
    })

    it('rejects opencode-models for non-OpenCode sessions', async () => {
        const { app } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/opencode-models')

        expect(response.status).toBe(400)
    })

    it('applies permission mode changes for inactive sessions', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/permission-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'bypassPermissions' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { permissionMode: 'bypassPermissions' }]
        ])
    })

    it('rejects unsupported permission mode for flavor via resume body', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'codex' }
        })
        const { app } = createApp(session)

        const response = await app.request('/api/sessions/session-1/resume', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ permissionMode: 'bypassPermissions' })
        })

        expect(response.status).toBe(400)
    })

    it('passes permissionMode from resume body to resumeSession', async () => {
        const session = createSession({
            active: false,
            metadata: { path: '/tmp/project', host: 'localhost', flavor: 'claude' }
        })
        let capturedResumeOpts: { permissionMode?: string } | undefined
        const { app } = createApp(session, {
            resumeSession: async (sessionId, _namespace, resumeOpts) => {
                capturedResumeOpts = resumeOpts
                return { type: 'success', sessionId }
            }
        })

        const response = await app.request('/api/sessions/session-1/resume', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ permissionMode: 'bypassPermissions' })
        })

        expect(response.status).toBe(200)
        expect(capturedResumeOpts).toEqual({ permissionMode: 'bypassPermissions' })
    })

    it('falls back to metadata slash commands when RPC listing fails', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                slashCommands: ['help', 'memory', 'status']
            }
        })
        const { app } = createApp(session, {
            listSlashCommands: async () => {
                throw new Error('RPC unavailable')
            }
        })

        const response = await app.request('/api/sessions/session-1/slash-commands')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            commands: [
                { name: 'help', source: 'builtin' },
                { name: 'memory', source: 'builtin' },
                { name: 'status', source: 'builtin' }
            ]
        })
    })

    it('merges RPC and metadata slash commands without hiding built-ins', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                slashCommands: ['help', 'memory']
            }
        })
        const { app } = createApp(session, {
            listSlashCommands: async () => ({
                success: true,
                commands: [
                    { name: 'clear', source: 'builtin' },
                    { name: 'project-only', source: 'project', content: 'Project prompt' }
                ]
            })
        })

        const response = await app.request('/api/sessions/session-1/slash-commands')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: true,
            commands: [
                { name: 'help', source: 'builtin' },
                { name: 'memory', source: 'builtin' },
                { name: 'clear', source: 'builtin' },
                { name: 'project-only', source: 'project', content: 'Project prompt' }
            ]
        })
    })

})
