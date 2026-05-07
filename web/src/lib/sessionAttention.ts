import { useSyncExternalStore } from 'react'

export const SESSION_ATTENTION_DURATION_MS = 10_000

type SessionAttentionSnapshot = Readonly<Record<string, number>>

let snapshot: SessionAttentionSnapshot = {}
const listeners = new Set<() => void>()
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

function clearExpiryTimer(sessionId: string): void {
    const timer = expiryTimers.get(sessionId)
    if (!timer) {
        return
    }
    clearTimeout(timer)
    expiryTimers.delete(sessionId)
}

export function clearSessionAttention(): void {
    for (const timer of expiryTimers.values()) {
        clearTimeout(timer)
    }
    expiryTimers.clear()

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

    const token = Date.now()
    snapshot = {
        ...snapshot,
        [normalizedSessionId]: token
    }
    emit()

    clearExpiryTimer(normalizedSessionId)
    expiryTimers.set(normalizedSessionId, setTimeout(() => {
        expiryTimers.delete(normalizedSessionId)

        if (snapshot[normalizedSessionId] !== token) {
            return
        }

        const { [normalizedSessionId]: _removed, ...rest } = snapshot
        snapshot = rest
        emit()
    }, SESSION_ATTENTION_DURATION_MS))
}

export function useSessionAttentionTokens(): SessionAttentionSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
