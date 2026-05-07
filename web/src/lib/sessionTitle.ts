type SessionTitleSource = {
    id: string
    metadata?: {
        name?: string | null
        summary?: {
            text?: string | null
        } | null
        path?: string | null
    } | null
}

export const SESSION_TITLE_EMOJIS = [
    '🚀',
    '✨',
    '🧠',
    '🛠️',
    '💡',
    '🔥',
    '🌟',
    '🎯',
    '🧩',
    '🧪',
    '📦',
    '📁',
    '💻',
    '🛰️',
    '🔧',
    '⚙️',
    '🧭',
    '🗂️',
    '📌',
    '🔍',
    '📝',
    '📚',
    '🌈',
    '🪄',
    '🎨',
    '⚡',
    '🌱',
    '🌊',
    '☁️',
    '🌙',
    '⭐',
    '🍀',
    '🌸',
    '🍎',
    '🍉',
    '🍪',
    '☕',
    '🫖',
    '🎵',
    '🎲',
    '🪐',
    '🌍',
    '🦊',
    '🐼',
    '🐙',
    '🦄',
    '🐝',
    '🦉',
    '🐧',
    '🐬',
] as const

export function getSessionTitle(
    session: SessionTitleSource,
    options: {
        pathMode?: 'basename' | 'full'
    } = {}
): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }

    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }

    if (session.metadata?.path) {
        if (options.pathMode === 'full') {
            return session.metadata.path
        }

        const parts = session.metadata.path.split(/[\\/]+/).filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }

    return session.id.slice(0, 8)
}

export function hashSessionId(sessionId: string): number {
    let hash = 2166136261

    for (const char of sessionId) {
        hash ^= char.codePointAt(0) ?? 0
        hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
}

export function getSessionTitleEmoji(sessionId: string): string {
    const index = hashSessionId(sessionId) % SESSION_TITLE_EMOJIS.length
    return SESSION_TITLE_EMOJIS[index]
}

export function getDisplaySessionTitle(
    session: SessionTitleSource,
    options: {
        pathMode?: 'basename' | 'full'
    } = {}
): string {
    return `${getSessionTitleEmoji(session.id)} ${getSessionTitle(session, options)}`
}
