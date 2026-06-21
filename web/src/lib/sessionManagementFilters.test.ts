import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    normalizeSessionManagementSearch,
    sessionMatchesManagementMarkerColor,
    sessionMatchesManagementQuery,
    sessionMatchesManagementUpdateWindow
} from './sessionManagementFilters'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: Date.now(),
        metadata: {
            path: '/repo/hapi',
            name: 'Default Session',
            machineId: 'machine-1',
            flavor: 'codex',
        },
        todoProgress: null,
        pendingRequestsCount: 0,
        markerColor: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

describe('sessionManagementFilters', () => {
    it('normalizes search input', () => {
        expect(normalizeSessionManagementSearch('  HAPI  ')).toBe('hapi')
    })

    it('matches by query, marker color, and older-than windows', () => {
        const day = 24 * 60 * 60 * 1000
        const oldSession = makeSession({
            id: 'old',
            updatedAt: Date.now() - 4 * day,
            markerColor: 'blue',
            metadata: {
                path: '/repo/hapi',
                name: 'Cleanup Session',
                machineId: 'machine-1',
                flavor: 'codex',
            }
        })

        expect(sessionMatchesManagementQuery(oldSession, 'cleanup', 'desktop')).toBe(true)
        expect(sessionMatchesManagementQuery(oldSession, 'desktop', 'desktop')).toBe(true)
        expect(sessionMatchesManagementMarkerColor(oldSession, 'blue')).toBe(true)
        expect(sessionMatchesManagementMarkerColor(oldSession, 'red')).toBe(false)
        expect(sessionMatchesManagementUpdateWindow(oldSession, '3d')).toBe(true)
        expect(sessionMatchesManagementUpdateWindow(oldSession, '10m')).toBe(false)
    })
})
