import type { SessionEndReason } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import {
    isAutoRetryableErrorMessage,
    isTerminalAutoRetryableErrorMessage
} from '@hapi/protocol/autoContinue'
import type { Session, SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { NotificationChannel, NotificationHubOptions, TaskNotification } from './notificationTypes'
import {
    extractMessageEventText,
    extractMessageEventType,
    extractTaskNotification,
    isFailureEventMessage
} from './eventParsing'

export class NotificationHub {
    private readonly channels: NotificationChannel[]
    private readonly readyCooldownMs: number
    private readonly permissionDebounceMs: number
    private readonly lastKnownRequests: Map<string, Set<string>> = new Map()
    private readonly notificationDebounce: Map<string, NodeJS.Timeout> = new Map()
    private readonly lastReadyNotificationAt: Map<string, number> = new Map()
    /**
     * Sessions that have emitted an overload/capacity status.  The status
     * itself is always hidden while AUTO is enabled, but a ready event is
     * only hidden when the terminal failure is waiting for the delayed
     * server-side `continue`.
     */
    private readonly autoRetrySilentSessions: Set<string> = new Set()
    private readonly autoRetryAwaitingContinueSessions: Set<string> = new Set()
    private readonly autoRetryContinueInFlightSessions: Set<string> = new Set()
    private unsubscribeSyncEvents: (() => void) | null = null

    constructor(
        private readonly syncEngine: SyncEngine,
        channels: NotificationChannel[],
        options?: NotificationHubOptions
    ) {
        this.channels = channels
        this.readyCooldownMs = options?.readyCooldownMs ?? 5000
        this.permissionDebounceMs = options?.permissionDebounceMs ?? 500
        this.unsubscribeSyncEvents = this.syncEngine.subscribe((event) => {
            this.handleSyncEvent(event)
        })
    }

    stop(): void {
        if (this.unsubscribeSyncEvents) {
            this.unsubscribeSyncEvents()
            this.unsubscribeSyncEvents = null
        }

        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer)
        }
        this.notificationDebounce.clear()
        this.lastKnownRequests.clear()
        this.lastReadyNotificationAt.clear()
        this.autoRetrySilentSessions.clear()
        this.autoRetryAwaitingContinueSessions.clear()
        this.autoRetryContinueInFlightSessions.clear()
    }

    private handleSyncEvent(event: SyncEvent): void {
        if (event.type === 'settings-updated' && event.namespace) {
            if (!event.data.autoRetryEnabled) {
                this.clearAutoRetryStateByNamespace(event.namespace)
            }
            return
        }

        if ((event.type === 'session-updated' || event.type === 'session-added') && event.sessionId) {
            const session = this.syncEngine.getSession(event.sessionId)
            if (!session || !session.active) {
                this.clearSessionState(event.sessionId)
                return
            }
            if (!this.syncEngine.isAutoRetryEnabled(session.namespace)) {
                this.clearAutoRetryState(event.sessionId)
            }
            this.checkForPermissionNotification(session)
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.clearSessionState(event.sessionId)
            return
        }

        if (event.type === 'session-ended' && event.sessionId) {
            this.clearAutoRetryState(event.sessionId)
            if (event.reason === 'completed') {
                this.sendSessionCompletion(event.sessionId, event.reason).catch((error) => {
                    console.error('[NotificationHub] Failed to send session completion notification:', error)
                })
            }
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            const messageRecord = unwrapRoleWrappedRecordEnvelope(event.message?.content)
            if (messageRecord?.role === 'user') {
                const sentFrom = this.getSentFrom(messageRecord.meta)
                if (sentFrom === 'auto-retry') {
                    // AUTO continue starts a new attempt.  Keep the session
                    // silent until that attempt emits a successful ready.
                    this.autoRetrySilentSessions.add(event.sessionId)
                    this.autoRetryAwaitingContinueSessions.delete(event.sessionId)
                    this.autoRetryContinueInFlightSessions.add(event.sessionId)
                } else {
                    // A manual/other user message supersedes a pending AUTO
                    // recovery and restores normal notifications.
                    this.clearAutoRetryState(event.sessionId)
                }
            }

            const eventType = extractMessageEventType(event)
            if (eventType === 'ready') {
                if (this.shouldSuppressReady(event.sessionId)) {
                    return
                }
                this.clearAutoRetryState(event.sessionId)
                this.sendReadyNotification(event.sessionId).catch((error) => {
                    console.error('[NotificationHub] Failed to send ready notification:', error)
                })
                return
            }

            const eventMessage = extractMessageEventText(event)
            const session = this.getNotifiableSession(event.sessionId)
            if (eventMessage
                && session
                && this.syncEngine.isAutoRetryEnabled(session.namespace)
                && isAutoRetryableErrorMessage(eventMessage)) {
                this.autoRetrySilentSessions.add(event.sessionId)
                if (isTerminalAutoRetryableErrorMessage(eventMessage)) {
                    // The built-in retry loop has ended.  The delayed AUTO
                    // continuation is now the only thing that may make this
                    // turn ready again.
                    this.autoRetryAwaitingContinueSessions.add(event.sessionId)
                    this.autoRetryContinueInFlightSessions.delete(event.sessionId)
                } else if (this.autoRetryAwaitingContinueSessions.has(event.sessionId)) {
                    // A same-thread retry resumed before the delayed AUTO
                    // continuation fired.  Let its eventual ready event be
                    // treated as a normal successful completion.
                    this.autoRetryAwaitingContinueSessions.delete(event.sessionId)
                }
                return
            }

            const failureMessage = isFailureEventMessage(event)
            if (failureMessage) {
                const session = this.getNotifiableSession(event.sessionId)
                if (
                    session
                    && this.syncEngine.isAutoRetryEnabled(session.namespace)
                    && this.autoRetrySilentSessions.has(event.sessionId)
                ) {
                    // Once an overload recovery has started, launchers may
                    // emit a generic `Task failed`/`systemError` line while
                    // ending the failed turn.  Keep that implementation
                    // detail out of notifications too; the eventual ready
                    // event is the only user-facing signal for the recovery.
                    return
                }
                this.clearAutoRetryState(event.sessionId)
                this.sendFailureNotification(event.sessionId, failureMessage).catch((error) => {
                    console.error('[NotificationHub] Failed to send failure notification:', error)
                })
                return
            }

            const taskNotification = extractTaskNotification(event)
            if (taskNotification) {
                this.sendTaskNotification(event.sessionId, taskNotification).catch((error) => {
                    console.error('[NotificationHub] Failed to send task notification:', error)
                })
            }
        }
    }

    private clearSessionState(sessionId: string): void {
        const existingTimer = this.notificationDebounce.get(sessionId)
        if (existingTimer) {
            clearTimeout(existingTimer)
            this.notificationDebounce.delete(sessionId)
        }
        this.lastKnownRequests.delete(sessionId)
        this.lastReadyNotificationAt.delete(sessionId)
        this.clearAutoRetryState(sessionId)
    }

    private clearAutoRetryState(sessionId: string): void {
        this.autoRetrySilentSessions.delete(sessionId)
        this.autoRetryAwaitingContinueSessions.delete(sessionId)
        this.autoRetryContinueInFlightSessions.delete(sessionId)
    }

    private clearAutoRetryStateByNamespace(namespace: string): void {
        const sessionIds = new Set<string>([
            ...this.autoRetrySilentSessions,
            ...this.autoRetryAwaitingContinueSessions,
            ...this.autoRetryContinueInFlightSessions
        ])
        for (const sessionId of sessionIds) {
            if (this.syncEngine.getSession(sessionId)?.namespace === namespace) {
                this.clearAutoRetryState(sessionId)
            }
        }
    }

    private getSentFrom(meta: unknown): string | null {
        if (!meta || typeof meta !== 'object') return null
        const sentFrom = (meta as Record<string, unknown>).sentFrom
        return typeof sentFrom === 'string' ? sentFrom : null
    }

    private shouldSuppressReady(sessionId: string): boolean {
        if (!this.autoRetrySilentSessions.has(sessionId)) {
            return false
        }

        if (
            this.autoRetryAwaitingContinueSessions.has(sessionId)
            && !this.autoRetryContinueInFlightSessions.has(sessionId)
        ) {
            // This is the ready event emitted after the terminal failure,
            // before the 5-second AUTO continuation has been sent.
            return true
        }

        // Either the built-in retry succeeded, or an AUTO continuation was
        // already sent and this ready marks its successful completion.
        return false
    }

    private getNotifiableSession(sessionId: string): Session | null {
        const session = this.syncEngine.getSession(sessionId)
        if (!session || !session.active) {
            return null
        }
        return session
    }

    private checkForPermissionNotification(session: Session): void {
        const requests = session.agentState?.requests

        if (requests == null) {
            return
        }

        const newRequestIds = new Set(Object.keys(requests))
        const oldRequestIds = this.lastKnownRequests.get(session.id) || new Set()

        let hasNewRequests = false
        for (const requestId of newRequestIds) {
            if (!oldRequestIds.has(requestId)) {
                hasNewRequests = true
                break
            }
        }

        this.lastKnownRequests.set(session.id, newRequestIds)

        if (!hasNewRequests) {
            return
        }

        const existingTimer = this.notificationDebounce.get(session.id)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.notificationDebounce.delete(session.id)
            this.sendPermissionNotification(session.id).catch((error) => {
                console.error('[NotificationHub] Failed to send permission notification:', error)
            })
        }, this.permissionDebounceMs)

        this.notificationDebounce.set(session.id, timer)
    }

    private async sendPermissionNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        await this.notifyPermission(session)
    }

    private async sendReadyNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        const now = Date.now()
        const last = this.lastReadyNotificationAt.get(sessionId) ?? 0
        if (now - last < this.readyCooldownMs) {
            return
        }
        this.lastReadyNotificationAt.set(sessionId, now)

        await this.notifyReady(session)
    }

    private async sendFailureNotification(sessionId: string, message: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        for (const channel of this.channels) {
            if (typeof channel.sendFailure !== 'function') {
                continue
            }
            try {
                await channel.sendFailure(session, message)
            } catch (error) {
                console.error('[NotificationHub] Failed to send failure notification:', error)
            }
        }
    }

    private async sendTaskNotification(sessionId: string, notification: TaskNotification): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        await this.notifyTask(session, notification)
    }

    private async sendSessionCompletion(sessionId: string, reason: SessionEndReason): Promise<void> {
        const session = this.syncEngine.getSession(sessionId)
        if (!session) {
            return
        }

        await this.notifySessionCompletion(session, reason)
    }

    private async notifyReady(session: Session): Promise<void> {
        for (const channel of this.channels) {
            try {
                await channel.sendReady(session)
            } catch (error) {
                console.error('[NotificationHub] Failed to send ready notification:', error)
            }
        }
    }

    private async notifyPermission(session: Session): Promise<void> {
        for (const channel of this.channels) {
            try {
                await channel.sendPermissionRequest(session)
            } catch (error) {
                console.error('[NotificationHub] Failed to send permission notification:', error)
            }
        }
    }

    private async notifyTask(session: Session, notification: TaskNotification): Promise<void> {
        for (const channel of this.channels) {
            try {
                await channel.sendTaskNotification(session, notification)
            } catch (error) {
                console.error('[NotificationHub] Failed to send task notification:', error)
            }
        }
    }

    private async notifySessionCompletion(session: Session, reason: SessionEndReason): Promise<void> {
        for (const channel of this.channels) {
            if (typeof channel.sendSessionCompletion !== 'function') {
                continue
            }
            try {
                await channel.sendSessionCompletion(session, reason)
            } catch (error) {
                console.error('[NotificationHub] Failed to send session completion notification:', error)
            }
        }
    }
}
