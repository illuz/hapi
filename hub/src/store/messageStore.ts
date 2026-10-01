import type { Database } from 'bun:sqlite'

import type { StoredMessage } from './types'
import { addMessage, cancelQueuedMessage, copySessionMessages, deleteLiveReasoningSnapshots, deleteQueuedMessageById, lookupQueuedMessage, getMaxSeq, getMessages, getMessagesAfter, getMessagesSince, getMessagesByPosition, getMessagesAfterPosition, getMessagesBySeqRange, getNewestMessagePosition, getMessageEpoch, bumpMessageEpoch, getMessageByIdOrLocalId, getLocalMessageStates, getUninvokedLocalMessages, getUserTurnMessages, markMessagesInvoked, mergeSessionMessages, truncateMessagesFromLocalId, type CancelQueuedMessageResult, type LocalMessageState, type LookupQueuedMessageResult, type MessagePosition } from './messages'

export class MessageStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addMessage(sessionId: string, content: unknown, localId?: string): StoredMessage {
        return addMessage(this.db, sessionId, content, localId)
    }

    deleteLiveReasoningSnapshots(sessionId: string, streamId: string, keepMessageId?: string): number {
        return deleteLiveReasoningSnapshots(this.db, sessionId, streamId, keepMessageId)
    }

    getMessages(sessionId: string, limit: number = 200, beforeSeq?: number): StoredMessage[] {
        return getMessages(this.db, sessionId, limit, beforeSeq)
    }

    getMessagesAfter(sessionId: string, afterSeq: number, limit: number = 200): StoredMessage[] {
        return getMessagesAfter(this.db, sessionId, afterSeq, limit)
    }

    getMessagesSince(sessionId: string, sinceCreatedAt: number, limit: number = 5000): StoredMessage[] {
        return getMessagesSince(this.db, sessionId, sinceCreatedAt, limit)
    }

    getMessagesBySeqRange(
        sessionId: string,
        options: { startSeq?: number; endSeq?: number; beforeSeq?: number; limit?: number } = {}
    ): StoredMessage[] {
        return getMessagesBySeqRange(this.db, sessionId, options)
    }

    getMessagesByPosition(sessionId: string, limit: number, before?: MessagePosition): StoredMessage[] {
        return getMessagesByPosition(this.db, sessionId, limit, before)
    }

    getMessagesAfterPosition(
        sessionId: string,
        limit: number,
        after: MessagePosition,
        until?: MessagePosition
    ): StoredMessage[] {
        return getMessagesAfterPosition(this.db, sessionId, limit, after, until)
    }

    getNewestMessagePosition(sessionId: string): MessagePosition | null {
        return getNewestMessagePosition(this.db, sessionId)
    }

    getMessageEpoch(sessionId: string): number {
        return getMessageEpoch(this.db, sessionId)
    }

    bumpMessageEpoch(sessionId: string): number {
        return bumpMessageEpoch(this.db, sessionId)
    }

    getUninvokedLocalMessages(sessionId: string): StoredMessage[] {
        return getUninvokedLocalMessages(this.db, sessionId)
    }

    getLocalMessageStates(sessionId: string, localIds: string[]): LocalMessageState[] {
        return getLocalMessageStates(this.db, sessionId, localIds)
    }

    getUserTurnMessages(sessionId: string): StoredMessage[] {
        return getUserTurnMessages(this.db, sessionId)
    }

    getMaxSeq(sessionId: string): number {
        return getMaxSeq(this.db, sessionId)
    }

    getMessageByIdOrLocalId(sessionId: string, messageId: string): StoredMessage | null {
        return getMessageByIdOrLocalId(this.db, sessionId, messageId)
    }

    cancelQueuedMessage(sessionId: string, messageId: string): CancelQueuedMessageResult {
        return cancelQueuedMessage(this.db, sessionId, messageId)
    }

    lookupQueuedMessage(sessionId: string, messageId: string): LookupQueuedMessageResult {
        return lookupQueuedMessage(this.db, sessionId, messageId)
    }

    deleteQueuedMessageById(sessionId: string, messageId: string): boolean {
        return deleteQueuedMessageById(this.db, sessionId, messageId)
    }

    markMessagesInvoked(sessionId: string, localIds: string[], invokedAt: number): void {
        markMessagesInvoked(this.db, sessionId, localIds, invokedAt)
    }

    mergeSessionMessages(fromSessionId: string, toSessionId: string): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
        return mergeSessionMessages(this.db, fromSessionId, toSessionId)
    }

    copySessionMessages(
        fromSessionId: string,
        toSessionId: string,
        options?: { keepUserTurns?: number; dropLastUserTurns?: number; upToClaudeMessageUuid?: string }
    ): { copied: number } {
        return copySessionMessages(this.db, fromSessionId, toSessionId, options)
    }

    truncateMessagesFromLocalId(
        sessionId: string,
        localId: string,
        replacement: Array<{
            content: unknown
            localId?: string | null
            createdAt?: number
            invokedAt?: number | null
        }> = []
    ): { deleted: number; deletedIds: string[]; inserted: number; epoch: number } {
        return truncateMessagesFromLocalId(this.db, sessionId, localId, replacement)
    }
}
