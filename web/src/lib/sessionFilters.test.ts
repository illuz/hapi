import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { filterSessionsByActivityOrMarker } from './sessionFilters'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        markerColor: null,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('filterSessionsByActivityOrMarker', () => {
    it('returns all sessions when the filter is disabled', () => {
        const sessions = [
            makeSession({ id: 'active', active: true }),
            makeSession({ id: 'inactive' }),
            makeSession({ id: 'marked', markerColor: 'blue' })
        ]

        expect(filterSessionsByActivityOrMarker(sessions, false)).toEqual(sessions)
    })

    it('keeps active and marked sessions while hiding inactive unmarked sessions', () => {
        const sessions = [
            makeSession({ id: 'active', active: true }),
            makeSession({ id: 'inactive' }),
            makeSession({ id: 'marked', markerColor: 'purple' }),
            makeSession({ id: 'inactive-marked', active: false, markerColor: 'green' })
        ]

        expect(filterSessionsByActivityOrMarker(sessions, true).map((session) => session.id)).toEqual([
            'active',
            'marked',
            'inactive-marked'
        ])
    })

    it('keeps pinned sessions when the activity filter is enabled', () => {
        const sessions = [
            makeSession({ id: 'pinned', pinned: true }),
            makeSession({ id: 'inactive' })
        ]

        expect(filterSessionsByActivityOrMarker(sessions, true).map((session) => session.id)).toEqual(['pinned'])
    })
})
