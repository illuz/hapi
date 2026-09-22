import {
    AUTO_RETRY_CONTINUE_DELAY_MS,
    isTerminalAutoRetryableErrorMessage,
    normalizeAutoContinueSettings,
    parseAutoRetryMessage
} from '@hapi/protocol/autoContinue'
import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { Session, SyncEvent } from '@hapi/protocol/types'

type AutoRetryDeps = {
    getSession: (sessionId: string) => Session | undefined
    switchSession: (sessionId: string, to: 'remote' | 'local') => Promise<void>
    sendMessage: (sessionId: string, payload: { text: string; sentFrom: 'auto-retry' }) => Promise<void>
    delayMs?: number
}

export class AutoRetryService {
    private readonly pendingBySessionId = new Map<string, ReturnType<typeof setTimeout>>()

    constructor(private readonly deps: AutoRetryDeps) {
    }

    scheduleIfNeeded(sessionId: string, failureMessage: string): boolean {
        if (!isTerminalAutoRetryableErrorMessage(failureMessage)) {
            return false
        }

        const session = this.deps.getSession(sessionId)
        const settings = normalizeAutoContinueSettings(session?.metadata?.autoContinue)
        if (!session?.active || !settings.retryOnOverload) {
            return false
        }

        if (this.pendingBySessionId.has(sessionId)) {
            return true
        }

        const timer = setTimeout(() => {
            void this.continueSession(sessionId, timer)
        }, this.deps.delayMs ?? AUTO_RETRY_CONTINUE_DELAY_MS)
        timer.unref?.()
        this.pendingBySessionId.set(sessionId, timer)
        return true
    }

    handleEvent(event: SyncEvent): void {
        if (event.type !== 'message-received' || !event.sessionId) {
            return
        }

        const message = event.message?.content
        const roleWrapped = unwrapRoleWrappedRecordEnvelope(message)
        const envelope = roleWrapped && isObject(roleWrapped.content)
            && roleWrapped.content.type === 'event'
            ? roleWrapped.content
            : isObject(message) && message.type === 'event'
                ? message
                : isObject(message) && isObject(message.content) && message.content.type === 'event'
                    ? message.content
                    : null
        if (!envelope || !isObject(envelope.data)) {
            return
        }

        if (envelope.data.type === 'ready') {
            // A terminal overload/capacity error is followed by a ready event
            // when the launcher has no queued message left.  That ready event
            // only means the current turn ended; it must not cancel the
            // delayed AUTO continuation that was scheduled for the terminal
            // failure.  Built-in retries cancel the timer when their
            // in-progress status message arrives, and manual messages cancel
            // it through SyncEngine.sendMessage().
            return
        }

        if (envelope.data.type !== 'message') {
            return
        }

        const failureMessage = envelope.data.message
        if (typeof failureMessage === 'string') {
            const retryDetails = parseAutoRetryMessage(failureMessage)
            if (isTerminalAutoRetryableErrorMessage(failureMessage)) {
                this.scheduleIfNeeded(event.sessionId, failureMessage)
            } else if (retryDetails?.inProgress) {
                // A same-thread retry is still active (or another attempt
                // already completed), so a previously queued AUTO recovery
                // would be stale and must not send a duplicate `continue`.
                this.cancelPending(event.sessionId)
            } else if (failureMessage.trim().toLowerCase() !== 'task failed') {
                // Keep the compatibility wrapper (`Task failed`) alive: Codex
                // may emit it immediately after the terminal thread status.
                // Other status messages indicate that the pending recovery
                // was superseded (for example, a successful completion).
                this.cancelPending(event.sessionId)
            }
        }
    }

    stop(): void {
        for (const timer of this.pendingBySessionId.values()) {
            clearTimeout(timer)
        }
        this.pendingBySessionId.clear()
    }

    cancelPending(sessionId: string): void {
        const timer = this.pendingBySessionId.get(sessionId)
        if (!timer) {
            return
        }

        clearTimeout(timer)
        this.pendingBySessionId.delete(sessionId)
    }

    private async continueSession(
        sessionId: string,
        timer: ReturnType<typeof setTimeout>
    ): Promise<void> {
        try {
            const session = this.deps.getSession(sessionId)
            const settings = normalizeAutoContinueSettings(session?.metadata?.autoContinue)
            // A terminal provider failure is followed by a ready event, but
            // the hub may keep `thinking` true for the short queued-message
            // grace period.  The terminal event itself is the authoritative
            // signal that this turn ended, so do not let that cache grace
            // window suppress the scheduled continuation.
            if (!session?.active || !settings.retryOnOverload) {
                return
            }

            if (session.agentState?.controlledByUser) {
                await this.deps.switchSession(sessionId, 'remote')
            }

            await this.deps.sendMessage(sessionId, {
                text: 'continue',
                sentFrom: 'auto-retry'
            })
        } catch (error) {
            console.error('[AutoRetryService] Failed to continue session:', error)
        } finally {
            if (this.pendingBySessionId.get(sessionId) === timer) {
                this.pendingBySessionId.delete(sessionId)
            }
        }
    }
}
