type ForkableSessionLike = {
    metadata?: {
        flavor?: string | null
        agentSessionId?: string
        codexSessionId?: string
        claudeSessionId?: string
        path?: string
    } | null
}

export function canForkSession(session: ForkableSessionLike): boolean {
    const metadata = session.metadata
    const flavor = metadata?.flavor
    if (flavor !== 'codex' && flavor !== 'claude' && flavor !== null && flavor !== undefined) {
        return false
    }

    return Boolean(metadata?.agentSessionId ?? metadata?.codexSessionId ?? metadata?.claudeSessionId)
}

export function canSpawnSessionFromConfig(session: ForkableSessionLike): boolean {
    return typeof session.metadata?.path === 'string' && session.metadata.path.length > 0
}

export function getRollbackTurnsFromOutlineIndex(index: number, totalItems: number): number {
    if (!Number.isInteger(index) || !Number.isInteger(totalItems)) {
        throw new Error('index and totalItems must be integers')
    }
    if (index < 0 || index >= totalItems) {
        throw new Error('index out of range')
    }

    return totalItems - index - 1
}
