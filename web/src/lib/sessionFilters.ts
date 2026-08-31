import type { SessionSummary } from '@/types/api'

export function filterSessionsByActivityOrMarker(
    sessions: SessionSummary[],
    enabled: boolean
): SessionSummary[] {
    if (!enabled) {
        return sessions
    }

    return sessions.filter((session) => session.active || Boolean(session.markerColor) || session.pinned === true)
}
