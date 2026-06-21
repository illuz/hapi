const RESERVED_SESSION_ROUTE_SEGMENTS = new Set(['new', 'project-tools', 'manage'])

export function getSelectedSessionIdFromRoute(sessionId: string | null | undefined): string | null {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId || RESERVED_SESSION_ROUTE_SEGMENTS.has(normalizedSessionId)) {
        return null
    }
    return normalizedSessionId
}
