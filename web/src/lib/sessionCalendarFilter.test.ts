import { describe, expect, it } from 'vitest'
import { sessionDateKey, sessionMatchesCalendarDate } from './sessionCalendarFilter'

describe('sessionCalendarFilter', () => {
    it('supports epoch seconds and milliseconds', () => {
        const timestamp = new Date(2026, 8, 29, 12, 0, 0).getTime()
        expect(sessionDateKey(timestamp)).toBe('2026-09-29')
        expect(sessionDateKey(Math.floor(timestamp / 1000))).toBe('2026-09-29')
    })

    it('matches only the selected local calendar day', () => {
        expect(sessionMatchesCalendarDate({ updatedAt: new Date(2026, 8, 29).getTime() }, '2026-09-29')).toBe(true)
        expect(sessionMatchesCalendarDate({ updatedAt: new Date(2026, 8, 29).getTime() }, '2026-09-28')).toBe(false)
    })
})

