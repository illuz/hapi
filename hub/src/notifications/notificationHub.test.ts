import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent, SyncEventListener, SyncEngine } from '../sync/syncEngine'
import type { SessionEndReason } from '@hapi/protocol'
import type { NotificationChannel, TaskNotification } from './notificationTypes'
import { NotificationHub } from './notificationHub'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeSyncEngine {
    private readonly listeners: Set<SyncEventListener> = new Set()
    private readonly sessions: Map<string, Session> = new Map()
    private readonly autoRetryEnabled: Map<string, boolean> = new Map()

    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    setSession(session: Session): void {
        this.sessions.set(session.id, session)
    }

    isAutoRetryEnabled(namespace: string): boolean {
        return this.autoRetryEnabled.get(namespace) === true
    }

    setAutoRetryEnabled(namespace: string, enabled: boolean): void {
        this.autoRetryEnabled.set(namespace, enabled)
    }

    emit(event: SyncEvent): void {
        for (const listener of this.listeners) {
            listener(event)
        }
    }
}

class StubChannel implements NotificationChannel {
    readonly readySessions: Session[] = []
    readonly permissionSessions: Session[] = []
    readonly failures: Array<{ session: Session; message: string }> = []
    readonly taskNotifications: Array<{ session: Session; notification: TaskNotification }> = []
    readonly sessionCompletions: Session[] = []

    async sendReady(session: Session): Promise<void> {
        this.readySessions.push(session)
    }

    async sendPermissionRequest(session: Session): Promise<void> {
        this.permissionSessions.push(session)
    }

    async sendFailure(session: Session, message: string): Promise<void> {
        this.failures.push({ session, message })
    }

    async sendTaskNotification(session: Session, notification: TaskNotification): Promise<void> {
        this.taskNotifications.push({ session, notification })
    }

    async sendSessionCompletion(session: Session): Promise<void> {
        this.sessionCompletions.push(session)
    }
}

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
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

describe('NotificationHub', () => {
    it('debounces permission notifications and triggers when request IDs change', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 5,
            readyCooldownMs: 5
        })

        const firstSession = createSession({
            agentState: {
                requests: {
                    req1: { tool: 'Edit', arguments: {}, createdAt: 1 }
                }
            }
        })

        engine.setSession(firstSession)
        engine.emit({ type: 'session-updated', sessionId: firstSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(1)

        engine.emit({ type: 'session-updated', sessionId: firstSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(1)

        const secondSession = createSession({
            id: firstSession.id,
            namespace: firstSession.namespace,
            agentState: {
                requests: {
                    req2: { tool: 'Read', arguments: {}, createdAt: 2 }
                }
            }
        })

        engine.setSession(secondSession)
        engine.emit({ type: 'session-updated', sessionId: secondSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(2)

        hub.stop()
    })

    it('throttles ready notifications per session', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const session = createSession()
        engine.setSession(session)

        const readyEvent: SyncEvent = {
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
                        id: 'event-1',
                        type: 'event',
                        data: { type: 'ready' }
                    }
                }
            }
        }

        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(1)

        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(1)

        await sleep(30)
        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(2)

        hub.stop()
    })

    it('silences retryable overload failures until AUTO recovery starts', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 1
        })
        const session = createSession({
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
            }
        })
        engine.setSession(session)
        engine.setAutoRetryEnabled(session.namespace, true)

        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-failure',
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
        })
        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-ready-after-failure',
                seq: 2,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: { type: 'event', data: { type: 'ready' } }
                }
            }
        })
        await sleep(5)

        expect(channel.failures).toHaveLength(0)
        expect(channel.readySessions).toHaveLength(0)

        engine.setSession({ ...session, thinking: true })
        engine.emit({ type: 'session-updated', sessionId: session.id })
        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-ready-during-queued-grace',
                seq: 2,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: { type: 'event', data: { type: 'ready' } }
                }
            }
        })
        await sleep(5)
        expect(channel.readySessions).toHaveLength(0)

        engine.setSession({ ...session, thinking: false })
        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-auto-continue',
                seq: 3,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'user',
                    content: { type: 'text', text: 'continue' },
                    meta: { sentFrom: 'auto-retry' }
                }
            }
        })
        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-ready-after-success',
                seq: 4,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: { type: 'event', data: { type: 'ready' } }
                }
            }
        })
        await sleep(5)

        expect(channel.readySessions).toHaveLength(1)
        hub.stop()
    })

    it('keeps retryable failure notifications when AUTO is off', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel])
        const session = createSession()
        engine.setSession(session)

        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-capacity-failure',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'event',
                        data: {
                            type: 'message',
                            message: 'Selected model is at capacity'
                        }
                    }
                }
            }
        })
        await sleep(5)

        expect(channel.failures).toHaveLength(1)
        hub.stop()
    })

    it('keeps ready silent while terminal AUTO recovery is pending, then notifies after success', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 1
        })
        const session = createSession({
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
            }
        })
        engine.setSession(session)
        engine.setAutoRetryEnabled(session.namespace, true)

        const eventMessage = (id: string, content: unknown, seq: number): SyncEvent => ({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id,
                seq,
                localId: null,
                createdAt: 0,
                content
            }
        })

        engine.emit(eventMessage('failure', {
            role: 'agent',
            content: {
                type: 'event',
                data: { type: 'message', message: 'Task failed: Selected model is at capacity' }
            }
        }, 1))
        engine.emit(eventMessage('ready-before-auto', {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        }, 2))
        await sleep(5)
        expect(channel.readySessions).toHaveLength(0)

        engine.emit(eventMessage('auto-continue', {
            role: 'user',
            content: { type: 'text', text: 'continue' },
            meta: { sentFrom: 'auto-retry' }
        }, 3))
        engine.emit(eventMessage('ready-after-auto', {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        }, 4))
        await sleep(5)
        expect(channel.readySessions).toHaveLength(1)
        expect(channel.failures).toHaveLength(0)

        hub.stop()
    })

    it('allows ready after an in-progress built-in retry succeeds', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 1
        })
        const session = createSession({
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
            }
        })
        engine.setSession(session)
        engine.setAutoRetryEnabled(session.namespace, true)

        engine.emit({
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
                            message: 'Task failed: Our servers are currently overloaded; retrying same conversation (1/3)'
                        }
                    }
                }
            }
        })
        engine.emit({
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'ready-after-built-in-retry',
                seq: 2,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: { type: 'event', data: { type: 'ready' } }
                }
            }
        })
        await sleep(5)

        expect(channel.readySessions).toHaveLength(1)
        expect(channel.failures).toHaveLength(0)
        hub.stop()
    })

    it('sends task notifications for task_notification system messages', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const session = createSession()
        engine.setSession(session)

        const taskEvent: SyncEvent = {
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-task',
                seq: 2,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'output',
                        data: {
                            type: 'system',
                            subtype: 'task_notification',
                            status: 'completed',
                            summary: 'Commit T4 finished'
                        }
                    }
                }
            }
        }

        engine.emit(taskEvent)
        await sleep(5)

        expect(channel.taskNotifications).toHaveLength(1)
        expect(channel.taskNotifications[0]?.notification).toEqual({
            status: 'completed',
            summary: 'Commit T4 finished'
        })

        hub.stop()
    })

    it('sends session completion only for completed session-ended events', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const completedSession = createSession({ id: 'session-completed', active: false })
        const terminatedSession = createSession({ id: 'session-terminated', active: false })
        engine.setSession(completedSession)
        engine.setSession(terminatedSession)

        engine.emit({
            type: 'session-ended',
            sessionId: completedSession.id,
            reason: 'completed' satisfies SessionEndReason
        })
        engine.emit({
            type: 'session-ended',
            sessionId: terminatedSession.id,
            reason: 'terminated' satisfies SessionEndReason
        })
        await sleep(5)

        expect(channel.sessionCompletions).toHaveLength(1)
        expect(channel.sessionCompletions[0]?.id).toBe(completedSession.id)

        hub.stop()
    })
})
