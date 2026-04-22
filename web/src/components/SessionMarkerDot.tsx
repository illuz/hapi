import { getSessionMarkerColorHex } from '@/lib/sessionMarkers'
import type { SessionMarkerColor } from '@/types/api'

export function SessionMarkerDot(props: {
    markerColor: SessionMarkerColor | null | undefined
    size?: number
    className?: string
}) {
    const color = getSessionMarkerColorHex(props.markerColor)
    if (!color) {
        return null
    }

    const size = props.size ?? 8

    return (
        <span
            className={`inline-block rounded-full ${props.className ?? ''}`}
            style={{
                width: size,
                height: size,
                backgroundColor: color,
                boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 70%, transparent)`
            }}
            aria-hidden="true"
        />
    )
}
