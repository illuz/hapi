import { SESSION_MARKER_COLORS } from '@/lib/sessionMarkers'
import type { SessionMarkerColor } from '@/types/api'

const SESSION_COLOR_FILTER_STORAGE_KEY = 'hapi:sessionList:markerColorFilter'

function isSessionMarkerColor(value: string): value is SessionMarkerColor {
    return SESSION_MARKER_COLORS.includes(value as SessionMarkerColor)
}

export function loadSessionColorFilterPreference(): SessionMarkerColor | null {
    if (typeof window === 'undefined') return null

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

