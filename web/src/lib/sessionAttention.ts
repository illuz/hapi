import { useSyncExternalStore } from 'react'
import { isPageVisible, subscribePageVisibility } from '@/lib/pageVisibility'

export const SESSION_ATTENTION_DURATION_MS = 5 * 60_000

type SessionAttentionSnapshot = Readonly<Record<string, number>>
type SessionAttentionEntry = {
    token: number
    started: boolean
}

let snapshot: SessionAttentionSnapshot = {}
const listeners = new Set<() => void>()
const entries = new Map<string, SessionAttentionEntry>()
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
let visibilityUnsubscribe: (() => void) | null = null
let nextToken = 1

function emit(): void {
    for (const listener of listeners) {
        listener()
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function getSnapshot(): SessionAttentionSnapshot {
    return snapshot
}

function getServerSnapshot(): SessionAttentionSnapshot {
    return {}
}

function createAttentionToken(): number {
    const token = nextToken
    nextToken += 1
    return token
}

function clearExpiryTimer(sessionId: string): void {
    const timer = expiryTimers.get(sessionId)
    if (!timer) {
        return
    }
    clearTimeout(timer)
    expiryTimers.delete(sessionId)
}

function clearSnapshotEntry(sessionId: string): boolean {
    if (!(sessionId in snapshot)) {
        return false
    }
    const { [sessionId]: _removed, ...rest } = snapshot
    snapshot = rest
    return true
}

function setSnapshotEntry(sessionId: string, token: number): boolean {
    if (snapshot[sessionId] === token) {
        return false
    }
    snapshot = {
        ...snapshot,
        [sessionId]: token
    }
    return true
}

function clearVisibilitySubscription(): void {
    if (!visibilityUnsubscribe) {
        return
    }
    visibilityUnsubscribe()
    visibilityUnsubscribe = null
}

function ensureVisibilitySubscription(): void {
    if (visibilityUnsubscribe || entries.size === 0) {
        return
    }
    visibilityUnsubscribe = subscribePageVisibility(() => {
        if (!isPageVisible()) {
            return
        }

        let changed = false

        for (const [sessionId, entry] of entries) {
            if (entry.started) {
                continue
            }

            entry.started = true
            clearExpiryTimer(sessionId)
            expiryTimers.set(sessionId, setTimeout(() => {
                expireSessionAttention(sessionId, entry.token)
            }, SESSION_ATTENTION_DURATION_MS))

            if (setSnapshotEntry(sessionId, entry.token)) {
                changed = true
            }
        }

        if (Array.from(entries.values()).every((entry) => entry.started)) {
            clearVisibilitySubscription()
        }

        if (changed) {
            emit()
        }
    })
}

function expireSessionAttention(sessionId: string, token: number): void {
    const entry = entries.get(sessionId)
    if (!entry || entry.token !== token) {
        return
    }

    clearExpiryTimer(sessionId)
    entries.delete(sessionId)
    const changed = clearSnapshotEntry(sessionId)

    if (entries.size === 0) {
        clearVisibilitySubscription()
    }

    if (changed) {
        emit()
    }
}

export function clearSessionAttention(): void {
    for (const timer of expiryTimers.values()) {
        clearTimeout(timer)
    }
    expiryTimers.clear()
    entries.clear()
    clearVisibilitySubscription()

    if (Object.keys(snapshot).length === 0) {
        return
    }

    snapshot = {}
    emit()
}

export function getSessionAttentionSnapshot(): SessionAttentionSnapshot {
    return snapshot
}

export function triggerSessionAttention(sessionId: string): void {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
        return
    }

    clearExpiryTimer(normalizedSessionId)

    const token = createAttentionToken()
    const visible = isPageVisible()
    entries.set(normalizedSessionId, {
        token,
        started: visible
    })

    let changed = false
    if (visible) {
        changed = setSnapshotEntry(normalizedSessionId, token)
        expiryTimers.set(normalizedSessionId, setTimeout(() => {
            expireSessionAttention(normalizedSessionId, token)
        }, SESSION_ATTENTION_DURATION_MS))
    } else {
        changed = clearSnapshotEntry(normalizedSessionId)
        ensureVisibilitySubscription()
    }

    if (changed) {
        emit()
    }
}

export function useSessionAttentionTokens(): SessionAttentionSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
