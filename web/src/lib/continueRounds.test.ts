import { beforeEach, describe, expect, it } from 'vitest'
import { allocateContinueRound, allocateContinueRoundWithSource, getContinueRound, getContinueSource } from './continueRounds'

describe('continueRounds', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('allocates incrementing rounds per session', () => {
        expect(allocateContinueRound('session-1', 'local-1')).toBe(1)
        expect(allocateContinueRoundWithSource('session-1', 'local-2', 'auto')).toBe(2)
        expect(getContinueRound('session-1', 'local-1')).toBe(1)
        expect(getContinueRound('session-1', 'local-2')).toBe(2)
        expect(getContinueSource('session-1', 'local-1')).toBe('manual')
        expect(getContinueSource('session-1', 'local-2')).toBe('auto')
    })

    it('keeps rounds isolated per session', () => {
        expect(allocateContinueRound('session-1', 'local-1')).toBe(1)
        expect(allocateContinueRound('session-2', 'local-1')).toBe(1)
    })
})
