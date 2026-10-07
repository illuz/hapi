import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, TimelineSummaryItem } from '@/types/api'

// 折叠态只携带摘要，不携带工具明细；一次多取一些可以让大纲定位停留在
// 摘要时间轴内，而不是切回原始消息窗口后连续触发多次分页。
const TIMELINE_PAGE_LIMIT = 500
// CLI completion and the final assistant message can arrive in adjacent events.
// A short bounded retry closes that persistence/event-ordering window without
// turning the timeline into a polling loop.
const COMPLETION_REFRESH_DELAYS_MS = [160, 320, 640] as const

type TimelinePageState = {
    items: TimelineSummaryItem[]
    nextBeforeSeq: number | null
    hasMore: boolean
    epoch: number | null
}

const EMPTY_PAGE: TimelinePageState = {
    items: [],
    nextBeforeSeq: null,
    hasMore: false,
    epoch: null
}

function getTimelineItemKey(item: TimelineSummaryItem): string {
    // 工作组会随着尾部消息追加而从 work-group:start-end 变更为新的 range id；
    // seqStart 才是同一折叠轮次的稳定身份。
    return item.kind === 'work-group'
        ? `work-group:${item.seqStart}`
        : item.id
}

function mergeTimelineItems(current: TimelineSummaryItem[], incoming: TimelineSummaryItem[]): TimelineSummaryItem[] {
    const byKey = new Map<string, TimelineSummaryItem>()
    for (const item of current) byKey.set(getTimelineItemKey(item), item)
    for (const item of incoming) byKey.set(getTimelineItemKey(item), item)
    return [...byKey.values()].sort((left, right) => (
        left.seqStart - right.seqStart || left.seqEnd - right.seqEnd
    ))
}

/**
 * Loads the compact conversation timeline independently from the full message
 * window. Work-group details are fetched lazily and cached by group id.
 */
export function useConversationTimeline(options: {
    api: ApiClient | null
    sessionId: string | null
    enabled: boolean
    sessionState?: {
        active: boolean
        thinking: boolean
    } | null
}): {
    items: TimelineSummaryItem[]
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    error: string | null
    version: number
    loadMore: () => Promise<boolean>
    loadAtSeq: (seq: number) => Promise<boolean>
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
    const previousSessionStateRef = useRef<{
        sessionId: string
        active: boolean
        thinking: boolean
    } | null>(null)
    const completionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const completionRefreshScheduledRef = useRef(false)
    const currentSessionIdRef = useRef(options.sessionId)
    const enabledRef = useRef(options.enabled)
    currentSessionIdRef.current = options.sessionId
    enabledRef.current = options.enabled

    const loadFirstPage = useCallback(async (): Promise<TimelineSummaryItem[] | null> => {
        if (!options.api || !options.sessionId) return null
        const generation = ++requestGenerationRef.current
        setIsLoading(true)
        setError(null)
        try {
            const response = await options.api.getTimelineSummary(options.sessionId, {
                limit: TIMELINE_PAGE_LIMIT
            })
            if (generation !== requestGenerationRef.current) return null
            setPage((current) => {
                const responseEpoch = response.page.epoch ?? null
                const canMerge = current.items.length > 0 && current.epoch === responseEpoch
                const items = canMerge ? mergeTimelineItems(current.items, response.items) : response.items
                return {
                    items,
                    nextBeforeSeq: items[0]?.seqStart ?? response.page.nextBeforeSeq,
                    hasMore: canMerge ? current.hasMore || response.page.hasMore : response.page.hasMore,
                    epoch: responseEpoch
                }
            })
            setVersion((value) => value + 1)
            return response.items
        } catch (cause) {
            if (generation !== requestGenerationRef.current) return null
            setPage(EMPTY_PAGE)
            setError(cause instanceof Error ? cause.message : 'Failed to load conversation timeline')
            return null
        } finally {
            if (generation === requestGenerationRef.current) setIsLoading(false)
        }
    }, [options.api, options.sessionId])

    const scheduleCompletionRefresh = useCallback((sessionId: string, attempt = 0) => {
        if (completionRefreshTimerRef.current !== null) return

        const delay = COMPLETION_REFRESH_DELAYS_MS[Math.min(attempt, COMPLETION_REFRESH_DELAYS_MS.length - 1)]
        completionRefreshScheduledRef.current = true
        completionRefreshTimerRef.current = setTimeout(() => {
            completionRefreshTimerRef.current = null
            if (!enabledRef.current || currentSessionIdRef.current !== sessionId) {
                completionRefreshScheduledRef.current = false
                return
            }

            void loadFirstPage().then((items) => {
                const latest = items?.at(-1)
                const hasFinalAssistantReply = latest?.kind === 'assistant'
                const hasMoreAttempts = attempt < COMPLETION_REFRESH_DELAYS_MS.length - 1
                if (hasFinalAssistantReply || !hasMoreAttempts) {
                    completionRefreshScheduledRef.current = false
                    return
                }
                scheduleCompletionRefresh(sessionId, attempt + 1)
            })
        }, delay)
    }, [loadFirstPage])

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

    useEffect(() => {
        const sessionState = options.sessionState
        if (!options.enabled || !options.sessionId || !sessionState) {
            previousSessionStateRef.current = null
            completionRefreshScheduledRef.current = false
            if (completionRefreshTimerRef.current !== null) {
                clearTimeout(completionRefreshTimerRef.current)
                completionRefreshTimerRef.current = null
            }
            return
        }

        const current = {
            sessionId: options.sessionId,
            active: sessionState.active,
            thinking: sessionState.thinking
        }
        const previous = previousSessionStateRef.current
        previousSessionStateRef.current = current

        // A new turn must not cancel a pending refresh from the previous cycle;
        // automatic continuation can start before its final assistant reply is persisted.
        const completed = previous
            && previous.sessionId === current.sessionId
            && previous.thinking
            && (!current.thinking || !current.active)
        if (
            !completed
            || completionRefreshScheduledRef.current
            || completionRefreshTimerRef.current !== null
        ) {
            return
        }

        scheduleCompletionRefresh(current.sessionId)
    }, [options.enabled, options.sessionId, options.sessionState?.active, options.sessionState?.thinking, scheduleCompletionRefresh])

    useEffect(() => {
        return () => {
            if (completionRefreshTimerRef.current !== null) {
                clearTimeout(completionRefreshTimerRef.current)
                completionRefreshTimerRef.current = null
            }
            completionRefreshScheduledRef.current = false
        }
    }, [])

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
                const responseEpoch = response.page.epoch ?? current.epoch
                if (current.epoch !== null && responseEpoch !== null && current.epoch !== responseEpoch) {
                    return {
                        items: response.items,
                        nextBeforeSeq: response.page.nextBeforeSeq,
                        hasMore: response.page.hasMore,
                        epoch: responseEpoch
                    }
                }
                const items = mergeTimelineItems(current.items, response.items)
                return {
                    items,
                    nextBeforeSeq: items[0]?.seqStart ?? response.page.nextBeforeSeq,
                    hasMore: response.page.hasMore,
                    epoch: responseEpoch
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

    const loadAtSeq = useCallback(async (seq: number): Promise<boolean> => {
        if (!options.api || !options.sessionId || !Number.isSafeInteger(seq) || seq < 1) return false
        try {
            const response = await options.api.getTimelineSummary(options.sessionId, {
                limit: TIMELINE_PAGE_LIMIT,
                aroundSeq: seq
            })
            setPage((current) => {
                const responseEpoch = response.page.epoch ?? current.epoch
                const sameEpoch = current.items.length > 0
                    && (current.epoch === null || responseEpoch === null || current.epoch === responseEpoch)
                const items = sameEpoch ? mergeTimelineItems(current.items, response.items) : response.items
                return {
                    items,
                    nextBeforeSeq: items[0]?.seqStart ?? response.page.nextBeforeSeq,
                    hasMore: sameEpoch ? current.hasMore || response.page.hasMore : response.page.hasMore,
                    epoch: responseEpoch
                }
            })
            setVersion((value) => value + 1)
            setError(null)
            return response.items.some((item) => item.seqStart <= seq && item.seqEnd >= seq)
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to load selected timeline item')
            return false
        }
    }, [options.api, options.sessionId])

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
        loadAtSeq,
        loadDetails,
        refetch
    }
}
