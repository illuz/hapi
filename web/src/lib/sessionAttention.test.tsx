import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    SESSION_ATTENTION_DURATION_MS,
    clearSessionAttention,
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
})
