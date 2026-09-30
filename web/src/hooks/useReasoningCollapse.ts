import { useCallback, useSyncExternalStore } from 'react'

export const DEFAULT_REASONING_COLLAPSED = false
const STORAGE_KEY = 'hapi-reasoning-collapsed'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function parse(raw: string | null): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_REASONING_COLLAPSED
}

function readStorage(): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(STORAGE_KEY)
    } catch {
        return null
    }
}

export function getInitialReasoningCollapsed(): boolean {
    return parse(readStorage())
}

let current = DEFAULT_REASONING_COLLAPSED
let unpersistedOverride = false
const listeners = new Set<() => void>()

function notify(): void {
    for (const listener of listeners) listener()
}

function syncFromStorage(): void {
    const next = parse(readStorage())
    if (next === current) return
    current = next
    notify()
}

function subscribe(listener: () => void): () => void {
    if (!unpersistedOverride) syncFromStorage()
    if (listeners.size === 0 && isBrowser()) {
        window.addEventListener('storage', onStorage)
    }
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && isBrowser()) window.removeEventListener('storage', onStorage)
    }
}

function onStorage(event: StorageEvent): void {
    if (event.key !== STORAGE_KEY) return
    unpersistedOverride = false
    syncFromStorage()
}

export function useReasoningCollapse(): {
    reasoningCollapsed: boolean
    setReasoningCollapsed: (value: boolean) => void
} {
    const reasoningCollapsed = useSyncExternalStore(subscribe, () => current, () => DEFAULT_REASONING_COLLAPSED)
    const setReasoningCollapsed = useCallback((value: boolean) => {
        let persisted = false
        if (isBrowser()) {
            try {
                if (value === DEFAULT_REASONING_COLLAPSED) localStorage.removeItem(STORAGE_KEY)
                else localStorage.setItem(STORAGE_KEY, String(value))
                persisted = true
            } catch {
                persisted = false
            }
        }
        unpersistedOverride = !persisted
        if (current !== value) {
            current = value
            notify()
        }
    }, [])
    return { reasoningCollapsed, setReasoningCollapsed }
}
