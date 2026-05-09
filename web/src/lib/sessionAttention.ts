import { useSyncExternalStore } from 'react'

export const SESSION_ATTENTION_DURATION_MS = 5 * 60_000

type SessionAttentionSnapshot = Readonly<Record<string, number>>
type SessionAttentionEntry = {
    token: number
    expiresAt: number
}

let snapshot: SessionAttentionSnapshot = {}
const listeners = new Set<() => void>()
const entries = new Map<string, SessionAttentionEntry>()
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
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

function expireSessionAttention(sessionId: string, token: number): void {
    const entry = entries.get(sessionId)
    if (!entry || entry.token !== token) {
        return
    }

    clearExpiryTimer(sessionId)
    entries.delete(sessionId)
    const changed = clearSnapshotEntry(sessionId)

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

    if (Object.keys(snapshot).length === 0) {
        return
    }

    snapshot = {}
    emit()
}

export function getSessionAttentionSnapshot(): SessionAttentionSnapshot {
    return snapshot
}

export function clearSessionAttentionForSession(sessionId: string): void {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
        return
    }

    clearExpiryTimer(normalizedSessionId)
    entries.delete(normalizedSessionId)
    if (clearSnapshotEntry(normalizedSessionId)) {
        emit()
    }
}

export function triggerSessionAttention(sessionId: string): void {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
        return
    }

    clearExpiryTimer(normalizedSessionId)

    const token = createAttentionToken()
    const now = Date.now()
    const entry = {
        token,
        expiresAt: now + SESSION_ATTENTION_DURATION_MS
    }
    entries.set(normalizedSessionId, entry)
    const changed = setSnapshotEntry(normalizedSessionId, token)
    expiryTimers.set(normalizedSessionId, setTimeout(() => {
        expireSessionAttention(normalizedSessionId, token)
    }, Math.max(0, entry.expiresAt - now)))

    if (changed) {
        emit()
    }
}

export function useSessionAttentionTokens(): SessionAttentionSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
