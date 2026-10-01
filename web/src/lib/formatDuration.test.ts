import { describe, expect, it } from 'vitest'
import { formatDuration } from '@/lib/formatDuration'

describe('formatDuration', () => {
    it('keeps sub-second durations in milliseconds', () => {
        expect(formatDuration(499)).toBe('499ms')
    })

    it('uses seconds and minutes instead of decimal seconds', () => {
        expect(formatDuration(61_000)).toBe('1m 1s')
    })

    it('includes hours when the work lasts for an hour or longer', () => {
        expect(formatDuration(3_723_000)).toBe('1h 2m 3s')
    })
})
