import type { ApiClient } from '@/api/client'
import {
    fetchLatestMessages,
    getQueuedReconcileCandidateLocalIds,
    markMessagesConsumed,
    reconcileQueuedLocalIds,
} from '@/lib/message-window-store'

const QUEUED_STATE_BATCH_SIZE = 1000

/**
 * Reconcile queued-looking rows after an SSE reconnect.
 *
 * `messages-consumed` is a live event. If the browser is disconnected while
 * the CLI dequeues a message, the authoritative Hub row can be invoked while
 * the persisted Web message window still says `Queued`. Refresh the tail
 * first, then ask the Hub for the state of any rows that still look queued.
 */
export async function reconcileQueuedStateAfterConnect(
    api: ApiClient,
    sessionId: string,
): Promise<void> {
    // Avoid loading the raw message tail on every initial SSE connect. The
    // reconciliation pass is only needed when this window already contains a
    // queued-looking row (usually restored from sessionStorage after a missed
    // `messages-consumed` event).
    const initialCandidates = getQueuedReconcileCandidateLocalIds(sessionId)
    if (initialCandidates.length === 0) {
        return
    }

    await fetchLatestMessages(api, sessionId)

    const candidateLocalIds = getQueuedReconcileCandidateLocalIds(sessionId)
    if (candidateLocalIds.length === 0) {
        return
    }

    const queuedLocalIds: string[] = []
    const invokedLocalMessages: Array<{ localId: string; invokedAt: number }> = []
    for (let index = 0; index < candidateLocalIds.length; index += QUEUED_STATE_BATCH_SIZE) {
        const batch = candidateLocalIds.slice(index, index + QUEUED_STATE_BATCH_SIZE)
        const state = await api.getQueuedState(sessionId, batch)
        queuedLocalIds.push(...state.queuedLocalIds)
        invokedLocalMessages.push(...state.invokedLocalMessages)
    }

    const invokedByTimestamp = new Map<number, string[]>()
    for (const message of invokedLocalMessages) {
        const localIds = invokedByTimestamp.get(message.invokedAt) ?? []
        localIds.push(message.localId)
        invokedByTimestamp.set(message.invokedAt, localIds)
    }
    for (const [invokedAt, localIds] of invokedByTimestamp) {
        markMessagesConsumed(sessionId, localIds, invokedAt)
    }

    reconcileQueuedLocalIds(sessionId, candidateLocalIds, queuedLocalIds)
}
