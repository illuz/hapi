import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_REASONING_COLLAPSED, getInitialReasoningCollapsed, useReasoningCollapse } from './useReasoningCollapse'

const KEY = 'hapi-reasoning-collapsed'

describe('useReasoningCollapse', () => {
    beforeEach(() => window.localStorage.clear())

    it('defaults to collapsed and persists the preference', () => {
        expect(getInitialReasoningCollapsed()).toBe(DEFAULT_REASONING_COLLAPSED)
        const { result } = renderHook(() => useReasoningCollapse())
        act(() => result.current.setReasoningCollapsed(false))
        expect(result.current.reasoningCollapsed).toBe(false)
        expect(window.localStorage.getItem(KEY)).toBe('false')
    })

    it('shares storage updates across hook instances', () => {
        const first = renderHook(() => useReasoningCollapse())
        const second = renderHook(() => useReasoningCollapse())
        act(() => first.result.current.setReasoningCollapsed(true))
        expect(second.result.current.reasoningCollapsed).toBe(true)
    })
})
