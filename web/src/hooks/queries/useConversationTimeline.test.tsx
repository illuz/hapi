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

function workGroup(seqStart: number, seqEnd: number): TimelineSummaryItem {
    return {
        id: `work-group:${seqStart}-${seqEnd}`,
        kind: 'work-group',
        createdAt: seqStart,
        lastActivityAt: seqEnd,
        seqStart,
        seqEnd,
        startedAt: seqStart,
        completedAt: seqEnd,
        durationMs: seqEnd - seqStart,
        work: {
            reasoningCount: 1,
            reviewCount: 0,
            eventCount: 0,
            toolGroupCount: 1,
            toolCount: 1,
            errorCount: 0,
            runningCount: seqEnd === seqStart ? 1 : 0,
            pendingCount: 0
        }
    }
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

    it('keeps the final assistant reply visible after a collapsed work group completes', async () => {
        const getTimelineSummary = vi.fn()
            .mockResolvedValueOnce(page([user(1), workGroup(2, 2)]))
            .mockResolvedValueOnce(page([user(1), workGroup(2, 4), assistant(5)], false))
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
        await waitFor(() => expect(result.current.items.map((item) => item.kind)).toEqual(['user', 'work-group']))

        rerender({ thinking: false })

        await waitFor(() => expect(result.current.items.map((item) => item.kind)).toEqual(['user', 'work-group', 'assistant']))
        expect(result.current.items.at(-1)?.text).toBe('Answer 5')
    })

    it('retries when the final assistant reply lands after the first completion snapshot', async () => {
        const getTimelineSummary = vi.fn()
            .mockResolvedValueOnce(page([user(1), workGroup(2, 2)]))
            .mockResolvedValueOnce(page([user(1), workGroup(2, 4)], false))
            .mockResolvedValueOnce(page([user(1), workGroup(2, 4), assistant(5)], false))
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
        await waitFor(() => expect(result.current.items.map((item) => item.kind)).toEqual(['user', 'work-group']))

        rerender({ thinking: false })

        await waitFor(
            () => expect(result.current.items.map((item) => item.kind)).toEqual(['user', 'work-group', 'assistant']),
            { timeout: 1_000 }
        )
    })
})
