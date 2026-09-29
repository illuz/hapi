import { useSyncExternalStore } from 'react'
import type { SessionSummary } from '@/types/api'

const STORAGE_KEY = 'hapi.sessionLastSeen.v1'
const BASELINE_KEY = 'hapi.sessionLastSeenBaseline.v1'
const CHANGE_EVENT = 'hapi.sessionLastSeen.changed'

type Store = Record<string, number>
let version = 0

function storage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function readStore(): Store {
    const value = storage()
    if (!value) return {}
    try {
        const parsed: unknown = JSON.parse(value.getItem(STORAGE_KEY) ?? '{}')
        if (!parsed || typeof parsed !== 'object') return {}
        return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === 'number' && Number.isFinite(item)))
    } catch {
        return {}
    }
}

function writeStore(store: Store): boolean {
    const value = storage()
    if (!value) return false
    try {
        value.setItem(STORAGE_KEY, JSON.stringify(store))
        return true
    } catch {
        return false
    }
}

function notify(): void {
    version += 1
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            version += 1
            listener()
        }
    }
    window.addEventListener(CHANGE_EVENT, listener)
    window.addEventListener('storage', onStorage)
    return () => {
        window.removeEventListener(CHANGE_EVENT, listener)
        window.removeEventListener('storage', onStorage)
    }
}

export function useSessionLastSeenVersion(): number {
    return useSyncExternalStore(subscribe, () => version, () => 0)
}

export function getSessionLastSeenAt(sessionId: string): number {
    const value = readStore()[sessionId]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function getSessionLastSeenSnapshot(): Readonly<Record<string, number>> {
    return readStore()
}

export function sessionIsUnread(session: Pick<SessionSummary, 'id' | 'updatedAt'>): boolean {
    return session.updatedAt > getSessionLastSeenAt(session.id)
}

export function markSessionSeen(sessionId: string, updatedAt: number): void {
    if (!sessionId || !Number.isFinite(updatedAt)) return
    const store = readStore()
    const previous = store[sessionId] ?? 0
    if (updatedAt <= previous) return
    store[sessionId] = updatedAt
    if (writeStore(store)) notify()
}

/** Seed the first list snapshot so existing sessions are not all shown as unread. */
export function initializeSessionLastSeen(scope: string, sessions: Iterable<Pick<SessionSummary, 'id' | 'updatedAt'>>): void {
    const value = storage()
    if (!value) return
    const baselineKey = `${BASELINE_KEY}:${scope}`
    try {
        if (value.getItem(baselineKey) === '1') return
        const store = readStore()
        for (const session of sessions) {
            if (session.id && Number.isFinite(session.updatedAt) && store[session.id] === undefined) {
                store[session.id] = session.updatedAt
            }
        }
        writeStore(store)
        value.setItem(baselineKey, '1')
        notify()
    } catch {
        // Ignore storage failures; unread indicators remain best-effort.
    }
}

