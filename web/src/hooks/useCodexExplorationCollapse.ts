import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_CODEX_EXPLORATION_COLLAPSED = true

const STORAGE_KEY = 'hapi-codex-exploration-collapsed'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStorage(): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(STORAGE_KEY)
    } catch {
        return null
    }
}

function parse(raw: string | null): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_CODEX_EXPLORATION_COLLAPSED
}

export function getInitialCodexExplorationCollapsed(): boolean {
    return parse(readStorage())
}

export function useCodexExplorationCollapse(): {
    codexExplorationCollapsed: boolean
    setCodexExplorationCollapsed: (value: boolean) => void
} {
    const [codexExplorationCollapsed, setState] = useState(getInitialCodexExplorationCollapsed)

    useEffect(() => {
        if (!isBrowser()) return
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) setState(parse(event.newValue))
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setCodexExplorationCollapsed = useCallback((value: boolean) => {
        setState(value)
        if (!isBrowser()) return
        try {
            if (value === DEFAULT_CODEX_EXPLORATION_COLLAPSED) localStorage.removeItem(STORAGE_KEY)
            else localStorage.setItem(STORAGE_KEY, String(value))
        } catch {
            // Preferences remain active for this render even if storage is unavailable.
        }
    }, [])

    return { codexExplorationCollapsed, setCodexExplorationCollapsed }
}
