import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
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
    type OlderMessagesLoadOptions,
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
export function useMessages(api: ApiClient | null, sessionId: string | null, options?: {
    deferInitialSync?: boolean
}): {
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
    loadMore: (options?: OlderMessagesLoadOptions) => Promise<boolean>
    loadAtSeq: (seq: number) => Promise<boolean>
    refetch: () => Promise<void>
    activateFullMessages: () => Promise<void>
    flushPending: () => void
    setAtBottom: (atBottom: boolean) => void
    setViewMode: (mode: MessageViewMode) => void
} {
    const deferInitialSync = options?.deferInitialSync === true
    const initialSyncDeferredRef = useRef(deferInitialSync)
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
        initialSyncDeferredRef.current = deferInitialSync
    }, [deferInitialSync, sessionId])

    useEffect(() => {
        if (api && sessionId && !initialSyncDeferredRef.current) {
            void syncTailMessages(api, sessionId)
        }
    }, [api, sessionId, deferInitialSync])

    const activateFullMessages = useCallback(async () => {
        initialSyncDeferredRef.current = false
        if (!api || !sessionId) return
        await syncTailMessages(api, sessionId, { ensureAfterCurrent: true })
    }, [api, sessionId])

    const loadMore = useCallback(async (options?: OlderMessagesLoadOptions) => {
        if (!api || !sessionId) return false
        return await fetchOlderMessages(api, sessionId, options)
    }, [api, sessionId])

    const loadAtSeq = useCallback(async (seq: number) => {
        if (!api || !sessionId) return false
        return await fetchMessagesAtSeq(api, sessionId, seq)
    }, [api, sessionId])

    const refetch = useCallback(async () => {
        await activateFullMessages()
    }, [activateFullMessages])

    const setViewMode = useCallback((mode: MessageViewMode) => {
        if (!sessionId) return
        const previousMode = getMessageWindowState(sessionId).viewMode
        setMessageViewMode(sessionId, mode)
        if (mode === 'tail' && previousMode !== 'tail' && api) {
            initialSyncDeferredRef.current = false
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
        activateFullMessages,
        flushPending,
        setAtBottom,
        setViewMode,
    }
}
