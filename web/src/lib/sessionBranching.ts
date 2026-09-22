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
