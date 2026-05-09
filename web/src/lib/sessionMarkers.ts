import { SESSION_MARKER_COLORS as PROTOCOL_SESSION_MARKER_COLORS, type SessionMarkerColor } from '@hapi/protocol'

// Web UI specific display order:
// planning → in progress → wrap-up → continue later → reference → focus/mainline.
const SESSION_MARKER_COLOR_PREFERENCE = [
    'orange',
    'blue',
    'green',
    'yellow',
    'purple',
    'red'
] as const satisfies readonly SessionMarkerColor[]

export const SESSION_MARKER_COLORS: SessionMarkerColor[] = SESSION_MARKER_COLOR_PREFERENCE.filter(
    (color): color is SessionMarkerColor => PROTOCOL_SESSION_MARKER_COLORS.includes(color)
)

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
