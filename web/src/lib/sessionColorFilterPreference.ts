import { SESSION_MARKER_COLORS } from '@/lib/sessionMarkers'
import type { SessionMarkerColor } from '@/types/api'

const SESSION_COLOR_FILTER_STORAGE_KEY = 'hapi:sessionList:markerColorFilter'

function isSessionMarkerColor(value: string): value is SessionMarkerColor {
    return SESSION_MARKER_COLORS.includes(value as SessionMarkerColor)
}

function getSessionColorFilterFromUrlParams(): SessionMarkerColor | null {
    if (typeof window === 'undefined') return null

    const query = new URLSearchParams(window.location.search)
    const type = query.get('type')
    if (!type) return null

    const markerIndex = Number(type)
    if (!Number.isInteger(markerIndex)) return null

    return SESSION_MARKER_COLORS[markerIndex - 1] ?? null
}

export function loadSessionColorFilterPreference(): SessionMarkerColor | null {
    if (typeof window === 'undefined') return null

    const urlMarkerColor = getSessionColorFilterFromUrlParams()
    if (urlMarkerColor) return urlMarkerColor

    try {
        const value = window.localStorage.getItem(SESSION_COLOR_FILTER_STORAGE_KEY)
        return value && isSessionMarkerColor(value) ? value : null
    } catch {
        return null
    }
}

export function saveSessionColorFilterPreference(markerColor: SessionMarkerColor | null): void {
    if (typeof window === 'undefined') return

    try {
        if (markerColor) {
            window.localStorage.setItem(SESSION_COLOR_FILTER_STORAGE_KEY, markerColor)
        } else {
            window.localStorage.removeItem(SESSION_COLOR_FILTER_STORAGE_KEY)
        }
    } catch {
        // Ignore storage failures: filtering should still work in-memory.
    }
}

