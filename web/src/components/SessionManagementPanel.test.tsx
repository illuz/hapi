import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { SessionManagementPanel } from './SessionManagementPanel'

const invalidateQueries = vi.fn()
const removeQueries = vi.fn()
const navigate = vi.fn()
const addToast = vi.fn()

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        invalidateQueries,
        removeQueries,
    }),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast }),
}))

vi.mock('@/lib/message-window-store', () => ({
    clearMessageWindow: vi.fn(),
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: ({
        isOpen,
        title,
        description,
        confirmLabel,
        onClose,
        onConfirm,
    }: {
        isOpen: boolean
        title: string
        description: string
        confirmLabel: string
        onClose: () => void
        onConfirm: () => Promise<void>
    }) => isOpen ? (
        <div>
            <div>{title}</div>
            <div>{description}</div>
            <button
                type="button"
                onClick={async () => {
                    await onConfirm()
                    onClose()
                }}
            >
                {confirmLabel}
            </button>
        </div>
    ) : null,
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const map: Record<string, string> = {
                'machine.unknown': 'Unknown machine',
                'sessions.manage': 'Manage sessions',
                'sessions.manage.summary': `${params?.visible ?? 0} of ${params?.total ?? 0} sessions shown, ${params?.selected ?? 0} selected`,
                'sessions.manage.status.all': 'All statuses',
                'sessions.manage.status.active': 'Active',
                'sessions.manage.status.inactive': 'Inactive',
                'sessions.manage.selectVisible': `Select visible (${params?.count ?? 0})`,
                'sessions.manage.clearVisible': 'Clear visible',
                'sessions.manage.clearSelection': 'Clear selection',
                'sessions.manage.bulkArchive': 'Archive selected',
                'sessions.manage.bulkDelete': 'Delete selected',
                'sessions.manage.bulkSetMarkerColor': 'Set color for selected',
                'sessions.manage.bulkArchive.noneApplicable': 'No active sessions selected for archiving.',
                'sessions.manage.bulkDelete.noneApplicable': 'No inactive sessions selected for deletion.',
                'sessions.manage.bulkSetMarkerColor.noneApplicable': 'No sessions selected for color changes.',
                'sessions.manage.bulkArchive.result': `Archived ${params?.success ?? 0}, skipped ${params?.skipped ?? 0}, failed ${params?.failed ?? 0}.`,
                'sessions.manage.bulkDelete.result': `Deleted ${params?.success ?? 0}, skipped ${params?.skipped ?? 0}, failed ${params?.failed ?? 0}.`,
                'sessions.manage.bulkSetMarkerColor.result': `Updated ${params?.success ?? 0}, failed ${params?.failed ?? 0}.`,
                'sessions.manage.column.select': 'Select',
                'sessions.manage.column.session': 'Session',
                'sessions.manage.column.path': 'Path',
                'sessions.manage.column.status': 'Status',
                'sessions.manage.column.updatedAt': 'Updated',
                'sessions.manage.empty': 'No sessions match the current filters.',
                'sessions.manage.selectSession': `Select session: ${params?.name ?? ''}`,
                'sessions.search.placeholder': 'Search sessions…',
                'sessions.colorFilter.all': 'All sessions',
                'sessions.timeFilter.all': 'Any time',
                'sessions.timeFilter.10m': 'Last 10 minutes',
                'sessions.timeFilter.30m': 'Last 30 minutes',
                'sessions.timeFilter.1h': 'Last hour',
                'sessions.timeFilter.6h': 'Last 6 hours',
                'sessions.timeFilter.12h': 'Last 12 hours',
                'sessions.timeFilter.last1d': 'Last 1 day',
                'sessions.timeFilter.last3d': 'Last 3 days',
                'sessions.timeFilter.1d': 'Older than 1 day',
                'sessions.timeFilter.3d': 'Older than 3 days',
                'sessions.timeFilter.10d': 'Older than 10 days',
                'session.action.marker': 'Marker color',
                'session.action.clearMarker': 'Clear marker',
                'session.marker.orange': 'Planning',
                'session.marker.yellow': 'Continue later',
                'session.marker.green': 'Wrapping up',
                'session.marker.blue': 'In progress',
                'session.marker.purple': 'Reference',
                'session.marker.red': 'Focus',
                'session.item.pending': 'pending',
                'session.item.thinking': 'thinking',
                'dialog.manageArchive.title': 'Archive Sessions',
                'dialog.manageArchive.description': `Archive ${params?.count ?? 0} active sessions?`,
                'dialog.manageArchive.confirm': 'Archive',
                'dialog.manageDelete.title': 'Delete Sessions',
                'dialog.manageDelete.description': `Delete ${params?.count ?? 0} inactive sessions?`,
                'dialog.manageDelete.confirm': 'Delete',
            }
            return map[key] ?? key
        },
    }),
}))

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: Date.now(),
        metadata: {
            path: `/repo/${overrides.id}`,
            machineId: 'machine-1',
            flavor: 'codex',
            name: overrides.id,
        },
        todoProgress: null,
        pendingRequestsCount: 0,
        markerColor: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
    invalidateQueries.mockReset()
    removeQueries.mockReset()
    navigate.mockReset()
    addToast.mockReset()
})

describe('SessionManagementPanel', () => {
    it('filters sessions by status and query', () => {
        render(
            <SessionManagementPanel
                api={null}
                sessions={[
                    makeSession({ id: 'active-session', active: true }),
                    makeSession({ id: 'inactive-session', active: false }),
                ]}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                isLoading={false}
                onClose={vi.fn()}
            />
        )

        expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('active-session'))).toBe(true)
        expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('inactive-session'))).toBe(true)

        fireEvent.change(screen.getByDisplayValue('All statuses'), {
            target: { value: 'active' }
        })

        expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('active-session'))).toBe(true)
        expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('inactive-session'))).toBe(false)

        fireEvent.change(screen.getByPlaceholderText('Search sessions…'), {
            target: { value: 'zzz' }
        })

        expect(screen.getByText('No sessions match the current filters.')).toBeInTheDocument()
    })

    it('archives active selected sessions and skips inactive ones', async () => {
        const archiveSessions = vi.fn().mockResolvedValue({
            successIds: ['active-session'],
            skipped: [],
            failed: []
        })
        const api = { archiveSessions } as unknown as { archiveSessions: (ids: string[]) => Promise<unknown> }

        render(
            <SessionManagementPanel
                api={api as never}
                sessions={[
                    makeSession({ id: 'active-session', active: true }),
                    makeSession({ id: 'inactive-session', active: false }),
                ]}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                isLoading={false}
                onClose={vi.fn()}
            />
        )

        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(screen.getByRole('button', { name: /Archive selected/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

        await waitFor(() => {
            expect(archiveSessions).toHaveBeenCalledWith(['active-session'])
        })

        expect(archiveSessions).toHaveBeenCalledTimes(1)
        expect(invalidateQueries).toHaveBeenCalled()
        await waitFor(() => {
            expect(addToast).toHaveBeenCalled()
        })
    })

    it('deletes inactive selected sessions via bulk API', async () => {
        const deleteSessions = vi.fn().mockResolvedValue({
            successIds: ['inactive-session'],
            skipped: [],
            failed: []
        })
        const api = { deleteSessions } as unknown as { deleteSessions: (ids: string[]) => Promise<unknown> }

        render(
            <SessionManagementPanel
                api={api as never}
                sessions={[
                    makeSession({ id: 'active-session', active: true }),
                    makeSession({ id: 'inactive-session', active: false }),
                ]}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                isLoading={false}
                onClose={vi.fn()}
            />
        )

        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(screen.getByRole('button', { name: /Delete selected/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

        await waitFor(() => {
            expect(deleteSessions).toHaveBeenCalledWith(['inactive-session'])
        })

        expect(deleteSessions).toHaveBeenCalledTimes(1)
        expect(removeQueries).toHaveBeenCalled()
        expect(invalidateQueries).toHaveBeenCalled()
    })

    it('sets marker color for selected sessions in bulk', async () => {
        const setSessionsMarkerColor = vi.fn().mockResolvedValue({
            successIds: ['active-session', 'inactive-session'],
            failed: []
        })
        const api = { setSessionsMarkerColor } as unknown as {
            setSessionsMarkerColor: (ids: string[], markerColor: string | null) => Promise<unknown>
        }

        render(
            <SessionManagementPanel
                api={api as never}
                sessions={[
                    makeSession({ id: 'active-session', active: true, markerColor: 'blue' }),
                    makeSession({ id: 'inactive-session', active: false, markerColor: 'blue' }),
                ]}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                isLoading={false}
                onClose={vi.fn()}
            />
        )

        const checkboxes = screen.getAllByRole('checkbox')
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        fireEvent.click(screen.getByRole('button', { name: /Set color for selected/ }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Focus' }))

        await waitFor(() => {
            expect(setSessionsMarkerColor).toHaveBeenCalledWith(['active-session', 'inactive-session'], 'red')
        })

        expect(invalidateQueries).toHaveBeenCalled()
        await waitFor(() => {
            expect(addToast).toHaveBeenCalled()
        })
    })

    it('clears marker color for selected sessions in bulk', async () => {
        const setSessionsMarkerColor = vi.fn().mockResolvedValue({
            successIds: ['inactive-session'],
            failed: []
        })
        const api = { setSessionsMarkerColor } as unknown as {
            setSessionsMarkerColor: (ids: string[], markerColor: string | null) => Promise<unknown>
        }

        render(
            <SessionManagementPanel
                api={api as never}
                sessions={[
                    makeSession({ id: 'inactive-session', active: false, markerColor: 'green' }),
                ]}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                isLoading={false}
                onClose={vi.fn()}
            />
        )

        fireEvent.click(screen.getAllByRole('checkbox')[0])
        fireEvent.click(screen.getByRole('button', { name: /Set color for selected/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Clear marker' }))

        await waitFor(() => {
            expect(setSessionsMarkerColor).toHaveBeenCalledWith(['inactive-session'], null)
        })

        expect(invalidateQueries).toHaveBeenCalled()
    })
})
