import { afterEach, describe, expect, it } from 'vitest'
import { loadSessionColorFilterPreference, saveSessionColorFilterPreference } from './sessionColorFilterPreference'

afterEach(() => {
    window.history.replaceState(null, '', '/')
    localStorage.clear()
})

describe('sessionColorFilterPreference', () => {
    it('maps URL type=6 to the red focus marker filter', () => {
        window.history.replaceState(null, '', '/?token=abc&type=6')

        expect(loadSessionColorFilterPreference()).toBe('red')
    })

    it('uses URL type before the stored marker filter', () => {
        localStorage.setItem('hapi:sessionList:markerColorFilter', 'blue')
        window.history.replaceState(null, '', '/?type=6')

        expect(loadSessionColorFilterPreference()).toBe('red')
    })

    it('falls back to local storage when URL type is invalid', () => {
        localStorage.setItem('hapi:sessionList:markerColorFilter', 'blue')
        window.history.replaceState(null, '', '/?type=999')

        expect(loadSessionColorFilterPreference()).toBe('blue')
    })

    it('removes the stored marker filter when saving null', () => {
        saveSessionColorFilterPreference('red')
        saveSessionColorFilterPreference(null)

        expect(localStorage.getItem('hapi:sessionList:markerColorFilter')).toBeNull()
    })
})
