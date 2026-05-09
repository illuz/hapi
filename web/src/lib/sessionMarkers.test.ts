import { describe, expect, it } from 'vitest'
import { SESSION_MARKER_COLORS, getSessionMarkerColorHex } from './sessionMarkers'

describe('sessionMarkers', () => {
    it('uses the curated marker order for the session menus', () => {
        expect(SESSION_MARKER_COLORS).toEqual([
            'orange',
            'blue',
            'green',
            'yellow',
            'purple',
            'red'
        ])
    })

    it('returns marker colors as hex values', () => {
        expect(getSessionMarkerColorHex('blue')).toBe('#4DA3FF')
        expect(getSessionMarkerColorHex(null)).toBeNull()
    })
})
