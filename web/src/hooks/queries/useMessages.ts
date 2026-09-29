import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage } from '@/types/api'
import {
    activateMessageWindow,
    fetchMessagesAtSeq,
    fetchOlderMessages,
    getMessageWindowState,
    setMessageViewMode,
    subscribeMessageWindow,
    syncTailMessages,
    type MessageViewMode,
    type MessageWindowState,
} from '@/lib/message-window-store'

export const EMPTY_STATE: MessageWindowState = {
    sessionId: 'unknown',
    messages: [],
    hasMore: false,
    oldestSeq: null,
    newestSeq: null,
    epoch: null,
    isSyncingTail: false,
    isLoadingMore: false,
    warning: null,
    viewMode: 'tail',
    unseenCount: 0,
    messagesVersion: 0,
    historyVersion: 0,
}

/**
 * Message-window hook kept source-compatible with the local SessionChat API.
 * The old pending buffer is now represented by the tail-sync store's
 * `unseenCount`; messages remain in the window while history mode is active.
 */
export function useMessages(api: ApiClient | null, sessionId: string | null): {
    messages: DecryptedMessage[]
    warning: string | null
    isLoading: boolean
    isSyncingTail: boolean
    isLoadingMore: boolean
    hasMore: boolean
    pendingCount: number
    unseenCount: number
    messagesVersion: number
    historyVersion: number
    loadMore: () => Promise<boolean>
    loadAtSeq: (seq: number) => Promise<boolean>
    refetch: () => Promise<void>
    flushPending: () => void
    setAtBottom: (atBottom: boolean) => void
    setViewMode: (mode: MessageViewMode) => void
} {
    const state = useSyncExternalStore(
        useCallback((listener) => {
            if (!sessionId) return () => {}
            return subscribeMessageWindow(sessionId, listener)
        }, [sessionId]),
        useCallback(() => sessionId ? getMessageWindowState(sessionId) : EMPTY_STATE, [sessionId]),
        () => EMPTY_STATE
    )

    useLayoutEffect(() => {
        if (sessionId) activateMessageWindow(sessionId)
    }, [sessionId])

    useEffect(() => {
        if (api && sessionId) {
            void syncTailMessages(api, sessionId)
        }
    }, [api, sessionId])

    const loadMore = useCallback(async () => {
        if (!api || !sessionId) return false
        return await fetchOlderMessages(api, sessionId)
    }, [api, sessionId])

    const loadAtSeq = useCallback(async (seq: number) => {
        if (!api || !sessionId) return false
        return await fetchMessagesAtSeq(api, sessionId, seq)
    }, [api, sessionId])

    const refetch = useCallback(async () => {
        if (!api || !sessionId) return
        await syncTailMessages(api, sessionId, { ensureAfterCurrent: true })
    }, [api, sessionId])

    const setViewMode = useCallback((mode: MessageViewMode) => {
        if (!sessionId) return
        const previousMode = getMessageWindowState(sessionId).viewMode
        setMessageViewMode(sessionId, mode)
        if (mode === 'tail' && previousMode !== 'tail' && api) {
            void syncTailMessages(api, sessionId, { ensureAfterCurrent: true })
        }
    }, [api, sessionId])

    const setAtBottom = useCallback((atBottom: boolean) => {
        setViewMode(atBottom ? 'tail' : 'history')
    }, [setViewMode])

    const flushPending = useCallback(() => {
        setAtBottom(true)
    }, [setAtBottom])

    return {
        messages: state.messages,
        warning: state.warning,
        isLoading: state.isSyncingTail,
        isSyncingTail: state.isSyncingTail,
        isLoadingMore: state.isLoadingMore,
        hasMore: state.hasMore,
        pendingCount: state.unseenCount,
        unseenCount: state.unseenCount,
        messagesVersion: state.messagesVersion,
        historyVersion: state.historyVersion,
        loadMore,
        loadAtSeq,
        refetch,
        flushPending,
        setAtBottom,
        setViewMode,
    }
}
