import { SESSION_MARKER_COLORS, type SessionMarkerColor } from '@hapi/protocol'

export { SESSION_MARKER_COLORS }
export type { SessionMarkerColor }

export const SESSION_MARKER_COLOR_HEX: Record<SessionMarkerColor, string> = {
    red: '#FF6B6B',
    orange: '#FF9F43',
    yellow: '#FFD166',
    green: '#2ECC71',
    blue: '#4DA3FF',
    purple: '#B084F5'
}

export function getSessionMarkerColorHex(markerColor: SessionMarkerColor | null | undefined): string | null {
    if (!markerColor) {
        return null
    }

    return SESSION_MARKER_COLOR_HEX[markerColor]
}
