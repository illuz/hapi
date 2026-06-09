import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ConversationHistoryEntry } from '@/types/api'

export type ConversationHistoryScope = 'session' | 'project' | 'all'

type PageCursor = {
    beforeCreatedAt: number | null
    beforeId: string | null
}

const EMPTY_CURSOR: PageCursor = { beforeCreatedAt: null, beforeId: null }

export function useConversationHistory(options: {
    api: ApiClient | null
    open: boolean
    scope: ConversationHistoryScope
    sessionId: string
    projectPath?: string | null
    query: string
    userOnly: boolean
}) {
    const [entries, setEntries] = useState<ConversationHistoryEntry[]>([])
    const [cursor, setCursor] = useState<PageCursor>(EMPTY_CURSOR)
    const [hasMore, setHasMore] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const requestKey = useMemo(() => JSON.stringify({
        scope: options.scope,
        sessionId: options.sessionId,
        projectPath: options.projectPath ?? null,
        query: options.query.trim(),
        userOnly: options.userOnly
    }), [options.scope, options.sessionId, options.projectPath, options.query, options.userOnly])

    const load = useCallback(async (mode: 'reset' | 'more') => {
        if (!options.api || !options.open) return
        if (mode === 'more' && (!hasMore || isLoadingMore)) return

        const activeCursor = mode === 'more' ? cursor : EMPTY_CURSOR
        mode === 'more' ? setIsLoadingMore(true) : setIsLoading(true)
        setError(null)

        try {
            const response = await options.api.getConversationHistory({
                scope: options.scope,
                sessionId: options.sessionId,
                projectPath: options.scope === 'project' ? options.projectPath : null,
                query: options.query.trim() || null,
                userOnly: options.userOnly,
                limit: 50,
                beforeCreatedAt: activeCursor.beforeCreatedAt,
                beforeId: activeCursor.beforeId
            })
            setEntries((previous) => mode === 'more'
                ? [...previous, ...response.entries]
                : response.entries)
            setCursor({
                beforeCreatedAt: response.page.nextBeforeCreatedAt,
                beforeId: response.page.nextBeforeId
            })
            setHasMore(response.page.hasMore)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load history')
        } finally {
            mode === 'more' ? setIsLoadingMore(false) : setIsLoading(false)
        }
    }, [cursor, hasMore, isLoadingMore, options.api, options.open, options.projectPath, options.query, options.userOnly, options.scope, options.sessionId])

    useEffect(() => {
        if (!options.open) return
        setEntries([])
        setCursor(EMPTY_CURSOR)
        setHasMore(false)
        void load('reset')
        // requestKey intentionally captures filters for reset.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options.open, requestKey])

    return {
        entries,
        hasMore,
        isLoading,
        isLoadingMore,
        error,
        reload: () => load('reset'),
        loadMore: () => load('more')
    }
}
