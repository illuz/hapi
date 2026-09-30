import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CODEX_EXPLORATION_COLLAPSED, getInitialCodexExplorationCollapsed, useCodexExplorationCollapse } from './useCodexExplorationCollapse'

const KEY = 'hapi-codex-exploration-collapsed'

describe('useCodexExplorationCollapse', () => {
    beforeEach(() => window.localStorage.clear())

    it('defaults to collapsed and persists an expanded preference', () => {
        expect(getInitialCodexExplorationCollapsed()).toBe(DEFAULT_CODEX_EXPLORATION_COLLAPSED)
        const { result } = renderHook(() => useCodexExplorationCollapse())
        act(() => result.current.setCodexExplorationCollapsed(false))
        expect(result.current.codexExplorationCollapsed).toBe(false)
        expect(window.localStorage.getItem(KEY)).toBe('false')
    })

    it('responds to cross-tab changes', () => {
        const { result } = renderHook(() => useCodexExplorationCollapse())
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'false' })))
        expect(result.current.codexExplorationCollapsed).toBe(false)
    })
})
