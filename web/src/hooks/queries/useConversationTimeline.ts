import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, TimelineSummaryItem } from '@/types/api'

const TIMELINE_PAGE_LIMIT = 60

type TimelinePageState = {
    items: TimelineSummaryItem[]
    nextBeforeSeq: number | null
    hasMore: boolean
}

const EMPTY_PAGE: TimelinePageState = {
    items: [],
    nextBeforeSeq: null,
    hasMore: false
}

/**
 * Loads the compact conversation timeline independently from the full message
 * window. Work-group details are fetched lazily and cached by group id.
 */
export function useConversationTimeline(options: {
    api: ApiClient | null
    sessionId: string | null
    enabled: boolean
}): {
    items: TimelineSummaryItem[]
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    error: string | null
    version: number
    loadMore: () => Promise<boolean>
    loadDetails: (groupId: string) => Promise<DecryptedMessage[]>
    refetch: () => Promise<void>
} {
    const [page, setPage] = useState<TimelinePageState>(EMPTY_PAGE)
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [version, setVersion] = useState(0)
    const requestGenerationRef = useRef(0)
    const detailsCacheRef = useRef<Map<string, Promise<DecryptedMessage[]>>>(new Map())
    const loadingMoreRef = useRef(false)

    const loadFirstPage = useCallback(async () => {
        if (!options.api || !options.sessionId) return
        const generation = ++requestGenerationRef.current
        setIsLoading(true)
        setError(null)
        try {
            const response = await options.api.getTimelineSummary(options.sessionId, {
                limit: TIMELINE_PAGE_LIMIT
            })
            if (generation !== requestGenerationRef.current) return
            setPage({
                items: response.items,
                nextBeforeSeq: response.page.nextBeforeSeq,
                hasMore: response.page.hasMore
            })
            setVersion((value) => value + 1)
        } catch (cause) {
            if (generation !== requestGenerationRef.current) return
            setPage(EMPTY_PAGE)
            setError(cause instanceof Error ? cause.message : 'Failed to load conversation timeline')
        } finally {
            if (generation === requestGenerationRef.current) setIsLoading(false)
        }
    }, [options.api, options.sessionId])

    useEffect(() => {
        requestGenerationRef.current += 1
        detailsCacheRef.current.clear()
        loadingMoreRef.current = false
        setPage(EMPTY_PAGE)
        setError(null)
        setVersion((value) => value + 1)
        if (options.enabled && options.api && options.sessionId) {
            void loadFirstPage()
        }
    }, [loadFirstPage, options.enabled, options.sessionId])

    const loadMore = useCallback(async (): Promise<boolean> => {
        if (!options.api || !options.sessionId || !page.hasMore || page.nextBeforeSeq === null || loadingMoreRef.current) {
            return false
        }
        loadingMoreRef.current = true
        setIsLoadingMore(true)
        try {
            const response = await options.api.getTimelineSummary(options.sessionId, {
                limit: TIMELINE_PAGE_LIMIT,
                beforeSeq: page.nextBeforeSeq
            })
            setPage((current) => {
                const existingIds = new Set(current.items.map((item) => item.id))
                const olderItems = response.items.filter((item) => !existingIds.has(item.id))
                return {
                    items: [...olderItems, ...current.items],
                    nextBeforeSeq: response.page.nextBeforeSeq,
                    hasMore: response.page.hasMore
                }
            })
            setVersion((value) => value + 1)
            setError(null)
            // An older raw page may contain only hidden/metadata records. It
            // still advances the cursor when `hasMore` is true; treating an
            // empty projection as terminal would strand the user at the same
            // visible page forever.
            return response.items.length > 0 || response.page.hasMore
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to load older timeline')
            return false
        } finally {
            loadingMoreRef.current = false
            setIsLoadingMore(false)
        }
    }, [options.api, options.sessionId, page.hasMore, page.nextBeforeSeq])

    const loadDetails = useCallback(async (groupId: string): Promise<DecryptedMessage[]> => {
        const cached = detailsCacheRef.current.get(groupId)
        if (cached) return await cached
        if (!options.api || !options.sessionId) {
            throw new Error('Session unavailable')
        }
        const request = options.api.getTimelineDetails(options.sessionId, groupId)
            .then((response) => response.messages)
            .catch((cause) => {
                detailsCacheRef.current.delete(groupId)
                throw cause
            })
        detailsCacheRef.current.set(groupId, request)
        return await request
    }, [options.api, options.sessionId])

    const refetch = useCallback(async () => {
        if (!options.enabled) return
        detailsCacheRef.current.clear()
        await loadFirstPage()
    }, [loadFirstPage, options.enabled])

    return {
        items: page.items,
        isLoading,
        isLoadingMore,
        hasMore: page.hasMore,
        error,
        version,
        loadMore,
        loadDetails,
        refetch
    }
}
