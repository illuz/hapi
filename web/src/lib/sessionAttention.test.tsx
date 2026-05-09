import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    SESSION_ATTENTION_DURATION_MS,
    clearSessionAttention,
    clearSessionAttentionForSession,
    getSessionAttentionSnapshot,
    triggerSessionAttention,
    useSessionAttentionTokens
} from './sessionAttention'

describe('sessionAttention', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        clearSessionAttention()
    })

    afterEach(() => {
        clearSessionAttention()
        vi.useRealTimers()
    })

    it('stores a flash token and clears it after the fade duration', () => {
        act(() => {
            triggerSessionAttention('session-1')
        })

        expect(getSessionAttentionSnapshot()['session-1']).toEqual(expect.any(Number))

        act(() => {
            vi.advanceTimersByTime(SESSION_ATTENTION_DURATION_MS - 1)
        })
        expect(getSessionAttentionSnapshot()['session-1']).toEqual(expect.any(Number))

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(getSessionAttentionSnapshot()['session-1']).toBeUndefined()
    })

    it('restarts the flash when the same session receives another notification', () => {
        const { result } = renderHook(() => useSessionAttentionTokens())

        act(() => {
            triggerSessionAttention('session-1')
        })
        const firstToken = result.current['session-1']

        act(() => {
            vi.advanceTimersByTime(200)
            triggerSessionAttention('session-1')
        })
        const secondToken = result.current['session-1']

        expect(firstToken).toEqual(expect.any(Number))
        expect(secondToken).toEqual(expect.any(Number))
        expect(secondToken).not.toBe(firstToken)

        act(() => {
            vi.advanceTimersByTime(SESSION_ATTENTION_DURATION_MS - 201)
        })
        expect(result.current['session-1']).toBe(secondToken)

        act(() => {
            vi.advanceTimersByTime(201)
        })
        expect(result.current['session-1']).toBeUndefined()
    })

    it('keeps the flash active for up to 5 minutes', () => {
        const { result } = renderHook(() => useSessionAttentionTokens())

        act(() => {
            triggerSessionAttention('session-1')
        })

        expect(result.current['session-1']).toEqual(expect.any(Number))

        act(() => {
            vi.advanceTimersByTime(SESSION_ATTENTION_DURATION_MS - 1)
        })
        expect(result.current['session-1']).toEqual(expect.any(Number))

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(result.current['session-1']).toBeUndefined()
    })

    it('clears a session flash once the session is opened', () => {
        const { result } = renderHook(() => useSessionAttentionTokens())

        act(() => {
            triggerSessionAttention('session-1')
            triggerSessionAttention('session-2')
        })

        expect(result.current['session-1']).toEqual(expect.any(Number))
        expect(result.current['session-2']).toEqual(expect.any(Number))

        act(() => {
            clearSessionAttentionForSession('session-1')
        })

        expect(result.current['session-1']).toBeUndefined()
        expect(result.current['session-2']).toEqual(expect.any(Number))
    })

    it('ignores clearing an unknown session attention id', () => {
        act(() => {
            triggerSessionAttention('session-1')
            clearSessionAttentionForSession('session-2')
        })

        expect(getSessionAttentionSnapshot()['session-1']).toEqual(expect.any(Number))
    })
})
