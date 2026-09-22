import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '@hapi/protocol/types'
import { AutoRetryService } from './autoRetryService'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex',
            autoContinue: {
                enabled: false,
                remaining: 20,
                maxRuns: 20,
                keywords: ['next step'],
                messageText: 'continue',
                retryOnOverload: true
            }
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        markerColor: null,
        pinned: false,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        ...overrides
    }
}

describe('AutoRetryService', () => {
    it('does not schedule when the namespace-wide AUTO switch is off', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => false,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(false)
        await sleep(20)

        expect(sends).toHaveLength(0)
        service.stop()
    })

    it('sends continue after the configured delay for a terminal capacity failure', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const switches: string[] = []
        const sends: Array<{ sessionId: string; text: string; sentFrom: string }> = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async (sessionId) => { switches.push(sessionId) },
            sendMessage: async (sessionId, payload) => { sends.push({ sessionId, ...payload }) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(true)
        expect(sends).toHaveLength(0)

        await sleep(20)

        expect(switches).toEqual([session.id])
        expect(sends).toEqual([{
            sessionId: session.id,
            text: 'continue',
            sentFrom: 'auto-retry'
        }])
        service.stop()
    })

    it('reads retryable failures from role-wrapped realtime events', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })
        const event: SyncEvent = {
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-1',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: {
                            type: 'message',
                            message: 'Our servers are currently overloaded'
                        }
                    }
                }
            }
        }

        service.handleEvent(event)
        await sleep(20)

        expect(sends).toEqual(['continue'])
        service.stop()
    })

    it('recovers when Codex only reports its generic thread systemError wrapper', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Codex thread entered systemError')).toBe(true)
        await sleep(20)

        expect(sends).toEqual(['continue'])
        service.stop()
    })

    it('does not schedule while the built-in retry loop is still running', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(
            session.id,
            'Task failed: Our servers are currently overloaded; retrying same conversation (2/3)'
        )).toBe(false)

        await sleep(20)
        expect(sends).toHaveLength(0)
        service.stop()
    })

    it('does not suppress recovery during the queued thinking grace period', async () => {
        let session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Our servers are currently overloaded')).toBe(true)
        session = createSession({ thinking: true })

        await sleep(20)
        expect(sends).toEqual(['continue'])
        service.stop()
    })

    it('cancels a pending recovery when another user action supersedes it', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(true)
        service.cancelPending(session.id)

        await sleep(20)
        expect(sends).toHaveLength(0)
        service.stop()
    })

    it('cancels a pending recovery when a same-thread retry arrives', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(true)
        service.handleEvent({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'retrying',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: {
                            type: 'message',
                            message: 'Task failed: Selected model is at capacity; retrying same conversation (1/3)'
                        }
                    }
                }
            }
        })

        await sleep(20)
        expect(sends).toHaveLength(0)
        service.stop()
    })

    it('keeps the delayed recovery when the terminal failure is followed by ready', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(true)
        service.handleEvent({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'ready-after-failure',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: { type: 'ready' }
                    }
                }
            }
        })

        await sleep(20)
        expect(sends).toEqual(['continue'])
        service.stop()
    })

    it('keeps recovery when Codex emits a context-free failure wrapper afterward', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Codex thread entered systemError')).toBe(true)
        service.handleEvent({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'generic-failure',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: { type: 'message', message: 'Task failed' }
                    }
                }
            }
        })

        await sleep(20)
        expect(sends).toEqual(['continue'])
        service.stop()
    })

    it('cancels recovery when a later completion supersedes the failure', async () => {
        const session = createSession()
        const sends: string[] = []
        const service = new AutoRetryService({
            getSession: () => session,
            isEnabled: () => true,
            switchSession: async () => {},
            sendMessage: async (_sessionId, payload) => { sends.push(payload.text) },
            delayMs: 5
        })

        expect(service.scheduleIfNeeded(session.id, 'Task failed: Selected model is at capacity')).toBe(true)
        service.handleEvent({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'completed',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: { type: 'message', message: 'Task completed' }
                    }
                }
            }
        })

        await sleep(20)
        expect(sends).toHaveLength(0)
        service.stop()
    })
})
