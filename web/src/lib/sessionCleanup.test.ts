import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow } from '@/lib/message-window-store'
import { cleanupInactiveSessions } from './sessionCleanup'

vi.mock('@/lib/message-window-store', () => ({
    clearMessageWindow: vi.fn()
}))

const clearMessageWindowMock = vi.mocked(clearMessageWindow)

function makeSession(id: string, overrides?: Partial<SessionSummary>): SessionSummary {
    return {
        id,
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        markerColor: null,
        metadata: {
            path: `/repo/${id}`,
            flavor: 'codex'
        },
        todoProgress: null,
        pendingRequestsCount: 0,
        model: null,
        effort: null,
        ...overrides
    }
}

describe('cleanupInactiveSessions', () => {
    afterEach(() => {
        clearMessageWindowMock.mockReset()
    })

    it('bulk deletes inactive sessions and clears successful ones', async () => {
        const deleteSessions = vi.fn().mockResolvedValue({
            successIds: ['session-1'],
            skipped: [],
            failed: []
        })
        const removeQueries = vi.fn()
        const invalidateQueries = vi.fn()
        const navigateToSessions = vi.fn()

        await cleanupInactiveSessions({
            api: { deleteSessions },
            queryClient: {
                removeQueries,
                invalidateQueries
            },
            inactiveSessions: [makeSession('session-1'), makeSession('session-2')],
            selectedSessionId: 'session-1',
            navigateToSessions
        })

        expect(deleteSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: queryKeys.session('session-1') })
        expect(clearMessageWindowMock).toHaveBeenCalledWith('session-1')
        expect(removeQueries).not.toHaveBeenCalledWith({ queryKey: queryKeys.session('session-2') })
        expect(clearMessageWindowMock).not.toHaveBeenCalledWith('session-2')
        expect(navigateToSessions).toHaveBeenCalledTimes(1)
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions })
    })

    it('is a no-op when there are no inactive sessions', async () => {
        const deleteSessions = vi.fn()
        const removeQueries = vi.fn()
        const invalidateQueries = vi.fn()
        const navigateToSessions = vi.fn()

        await cleanupInactiveSessions({
            api: { deleteSessions },
            queryClient: {
                removeQueries,
                invalidateQueries
            },
            inactiveSessions: [],
            selectedSessionId: null,
            navigateToSessions
        })

        expect(deleteSessions).not.toHaveBeenCalled()
        expect(removeQueries).not.toHaveBeenCalled()
        expect(invalidateQueries).not.toHaveBeenCalled()
        expect(navigateToSessions).not.toHaveBeenCalled()
    })
})
