import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { TimelineSummaryItem, TimelineSummaryResponse } from '@/types/api'
import { useConversationTimeline } from './useConversationTimeline'

function user(seq: number): TimelineSummaryItem {
    return { id: `user:${seq}`, kind: 'user', createdAt: seq, seqStart: seq, seqEnd: seq, text: `Turn ${seq}` }
}

function assistant(seq: number): TimelineSummaryItem {
    return { id: `assistant:${seq}`, kind: 'assistant', createdAt: seq, seqStart: seq, seqEnd: seq, text: `Answer ${seq}` }
}

function page(items: TimelineSummaryItem[], hasMore = true): TimelineSummaryResponse {
    return { items, page: { limit: 500, nextBeforeSeq: items[0]?.seqStart ?? null, hasMore } }
}

describe('useConversationTimeline', () => {
    it('keeps loaded history when live summaries refresh instead of returning to the latest page', async () => {
        const getTimelineSummary = vi.fn()
            .mockResolvedValueOnce(page([user(100), user(200)]))
            .mockResolvedValueOnce(page([user(1), user(50)], false))
            .mockResolvedValueOnce(page([user(100), user(200), user(201)], false))
        const api = { getTimelineSummary } as unknown as ApiClient
        const { result } = renderHook(() => useConversationTimeline({ api, sessionId: 's1', enabled: true }))
        await waitFor(() => expect(result.current.items).toHaveLength(2))

        await act(async () => { await result.current.loadMore() })
        expect(result.current.items.map((item) => item.seqStart)).toEqual([1, 50, 100, 200])

        await act(async () => { await result.current.refetch() })
        expect(result.current.items.map((item) => item.seqStart)).toEqual([1, 50, 100, 200, 201])
        expect(result.current.hasMore).toBe(false)
    })

    it('refreshes the compact timeline when a live task finishes', async () => {
        const getTimelineSummary = vi.fn()
            .mockResolvedValueOnce(page([user(100)]))
            .mockResolvedValueOnce(page([user(100), assistant(101)], false))
        const api = { getTimelineSummary } as unknown as ApiClient
        const { result, rerender } = renderHook(
            ({ thinking }) => useConversationTimeline({
                api,
                sessionId: 's1',
                enabled: true,
                sessionState: { active: true, thinking }
            }),
            { initialProps: { thinking: true } }
        )
        await waitFor(() => expect(result.current.items).toHaveLength(1))

        rerender({ thinking: false })

        await waitFor(() => expect(getTimelineSummary).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(result.current.items.map((item) => item.kind)).toEqual(['user', 'assistant']))
    })
})
