import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage } from '@/types/api'
import { appendOptimisticMessage, clearMessageWindow, ingestIncomingMessages, getMessageWindowState } from '@/lib/message-window-store'
import { reconcileQueuedStateAfterConnect } from '@/lib/queued-state-reconciliation'

const SESSION_ID = 'queued-state-reconciliation-test'

function makeQueuedMessage(overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
    return {
        id: 'server-message',
        seq: 1,
        localId: 'local-1',
        content: {
            role: 'user',
            content: { type: 'text', text: 'already executed' }
        },
        createdAt: 1,
        invokedAt: null,
        status: 'queued',
        ...overrides,
    }
}

describe('reconcileQueuedStateAfterConnect', () => {
    afterEach(() => {
        clearMessageWindow(SESSION_ID)
    })

    it('marks a queued-looking row consumed when the hub says it was already invoked', async () => {
        ingestIncomingMessages(SESSION_ID, [makeQueuedMessage()])
        const getMessages = vi.fn().mockResolvedValue({
            messages: [makeQueuedMessage()],
            page: {
                direction: 'latest',
                limit: 200,
                epoch: 0,
                reset: false,
                nextBeforeSeq: null,
                nextBeforeAt: null,
                nextAfterSeq: null,
                nextAfterAt: null,
                snapshotHeadSeq: 1,
                snapshotHeadAt: 1,
                hasMore: false,
            },
        })
        const getQueuedState = vi.fn().mockResolvedValue({
            queuedLocalIds: [],
            invokedLocalMessages: [{ localId: 'local-1', invokedAt: 2 }],
        })

        await reconcileQueuedStateAfterConnect(
            { getMessages, getQueuedState } as unknown as ApiClient,
            SESSION_ID,
        )

        expect(getQueuedState).toHaveBeenCalledWith(SESSION_ID, ['local-1'])
        const message = getMessageWindowState(SESSION_ID).messages[0]
        expect(message?.status).toBe('sent')
        expect(message?.invokedAt).toBe(2)
    })

    it('keeps a row that the hub still reports as queued', async () => {
        appendOptimisticMessage(SESSION_ID, makeQueuedMessage({ id: 'local-1', seq: null }))
        const getMessages = vi.fn().mockResolvedValue({
            messages: [],
            page: {
                direction: 'latest',
                limit: 200,
                epoch: 0,
                reset: false,
                nextBeforeSeq: null,
                nextBeforeAt: null,
                nextAfterSeq: null,
                nextAfterAt: null,
                snapshotHeadSeq: null,
                snapshotHeadAt: null,
                hasMore: false,
            },
        })
        const getQueuedState = vi.fn().mockResolvedValue({
            queuedLocalIds: ['local-1'],
            invokedLocalMessages: [],
        })

        await reconcileQueuedStateAfterConnect(
            { getMessages, getQueuedState } as unknown as ApiClient,
            SESSION_ID,
        )

        expect(getMessageWindowState(SESSION_ID).messages).toHaveLength(1)
    })
})
