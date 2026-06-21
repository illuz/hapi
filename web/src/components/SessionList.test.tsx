import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { getProjectToolCountsKey, SessionList } from './SessionList'

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTelegram: false,
        isTouch: false,
        haptic: {
            impact: vi.fn(),
            notification: vi.fn(),
            selection: vi.fn(),
        },
    }),
}))

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        archiveSession: vi.fn(),
        renameSession: vi.fn(),
        setSessionMarkerColor: vi.fn(),
        deleteSession: vi.fn(),
        forkSession: vi.fn(),
        spawnSessionFromConfig: vi.fn(),
        isPending: false,
    }),
}))

vi.mock('@/components/SessionActionMenu', () => ({
    SessionActionMenu: () => null,
}))

vi.mock('@/components/RenameSessionDialog', () => ({
    RenameSessionDialog: () => null,
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: () => null,
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const map: Record<string, string> = {
                'sessions.count': `${params?.n ?? 0} sessions in ${params?.m ?? 0} projects`,
                'sessions.search.placeholder': 'Search',
                'sessions.colorFilter.title': 'Filter marker color',
                'sessions.colorFilter.all': 'All sessions',
                'sessions.colorFilter.clear': 'Clear marker color filter',
                'sessions.timeFilter.title': 'Filter by last updated',
                'sessions.timeFilter.all': 'Any time',
                'sessions.timeFilter.clear': 'Clear last updated filter',
                'sessions.timeFilter.10m': 'Last 10 minutes',
                'sessions.timeFilter.30m': 'Last 30 minutes',
                'sessions.timeFilter.1h': 'Last hour',
                'sessions.timeFilter.6h': 'Last 6 hours',
                'sessions.timeFilter.12h': 'Last 12 hours',
                'sessions.timeFilter.1d': 'Older than 1 day',
                'sessions.timeFilter.3d': 'Older than 3 days',
                'sessions.timeFilter.10d': 'Older than 10 days',
                'sessions.group.showLess': 'Show less',
                'machine.unknown': 'Unknown machine',
                'session.time.justNow': 'just now',
                'session.marker.red': 'Focus',
                'session.marker.blue': 'In progress',
            }
            return map[key] ?? key
        },
    }),
}))

afterEach(() => {
    cleanup()
    localStorage.clear()
})

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 'session-1',
        active: true,
        thinking: false,
        activeAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
            path: '/repo',
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

describe('SessionList project tools buttons', () => {
    it('renders Agents and Cron count buttons without toggling the project row', () => {
        const onOpenProjectTools = vi.fn()
        render(
            <SessionList
                sessions={[makeSession()]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
                projectToolCountsByKey={{
                    [getProjectToolCountsKey('machine-1', '/repo')!]: { agents: 2, crons: 1 }
                }}
                onOpenProjectTools={onOpenProjectTools}
            />
        )

        const sessionTitle = screen.getByText(/🦉 repo/)
        expect(sessionTitle).toBeInTheDocument()

        const agentsButton = screen.getByRole('button', { name: 'Agents 2' })
        expect(agentsButton).toHaveTextContent('🤖 2')
        fireEvent.click(agentsButton)
        expect(onOpenProjectTools).toHaveBeenCalledWith({
            machineId: 'machine-1',
            projectPath: '/repo',
            tab: 'agents',
        })
        expect(sessionTitle).toBeInTheDocument()

        const cronButton = screen.getByRole('button', { name: 'Cron 1' })
        expect(cronButton).toHaveTextContent('⏰ 1')
        fireEvent.click(cronButton)
        expect(onOpenProjectTools).toHaveBeenLastCalledWith({
            machineId: 'machine-1',
            projectPath: '/repo',
            tab: 'cron',
        })
        expect(sessionTitle).toBeInTheDocument()
    })
})

describe('SessionList color filter', () => {
    it('filters sessions by selected marker color from the search row dropdown', () => {
        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'blue-session',
                        markerColor: 'blue',
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Blue Task' },
                    }),
                    makeSession({
                        id: 'red-session',
                        markerColor: 'red',
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Red Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.getByText(/Blue Task/)).toBeInTheDocument()
        expect(screen.getByText(/Red Task/)).toBeInTheDocument()
        expect(localStorage.getItem('hapi:sessionList:markerColorFilter')).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Filter marker color' }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: /In progress/ }))

        expect(screen.getByText(/Blue Task/)).toBeInTheDocument()
        expect(screen.queryByText(/Red Task/)).not.toBeInTheDocument()
        expect(localStorage.getItem('hapi:sessionList:markerColorFilter')).toBe('blue')

        fireEvent.click(screen.getByRole('button', { name: 'Clear marker color filter' }))

        expect(screen.getByText(/Blue Task/)).toBeInTheDocument()
        expect(screen.getByText(/Red Task/)).toBeInTheDocument()
        expect(localStorage.getItem('hapi:sessionList:markerColorFilter')).toBeNull()
    })

    it('restores the marker color filter from local storage', () => {
        localStorage.setItem('hapi:sessionList:markerColorFilter', 'red')

        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'blue-session',
                        markerColor: 'blue',
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Blue Task' },
                    }),
                    makeSession({
                        id: 'red-session',
                        markerColor: 'red',
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Red Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.queryByText(/Blue Task/)).not.toBeInTheDocument()
        expect(screen.getByText(/Red Task/)).toBeInTheDocument()
    })
})

describe('SessionList update-window filter', () => {
    it('filters sessions by last-updated window and clears the filter', () => {
        const HOUR = 60 * 60 * 1000
        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'recent',
                        updatedAt: Date.now() - 5 * 60 * 1000, // 5 分钟前
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Recent Task' },
                    }),
                    makeSession({
                        id: 'old',
                        updatedAt: Date.now() - 48 * HOUR, // 2 天前
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Old Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()

        // 选择「最近 10 分钟」：仅保留 Recent Task
        fireEvent.click(screen.getByRole('button', { name: 'Filter by last updated' }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Last 10 minutes/ }))

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.queryByText(/Old Task/)).not.toBeInTheDocument()

        // 清除筛选：两个会话都回来
        fireEvent.click(screen.getByRole('button', { name: 'Clear last updated filter' }))

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()
    })

    it('filters sessions older than 10 days when the 10d window is selected', () => {
        const DAY = 24 * 60 * 60 * 1000
        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'recent',
                        updatedAt: Date.now() - 5 * 60 * 1000,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Recent Task' },
                    }),
                    makeSession({
                        id: 'old',
                        updatedAt: Date.now() - 11 * DAY,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Old Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Filter by last updated' }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Older than 10 days/ }))

        expect(screen.queryByText(/Recent Task/)).not.toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()
    })

    it('filters sessions older than 3 days when the 3d window is selected', () => {
        const DAY = 24 * 60 * 60 * 1000
        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'recent',
                        updatedAt: Date.now() - 2 * DAY,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Recent Task' },
                    }),
                    makeSession({
                        id: 'old',
                        updatedAt: Date.now() - 4 * DAY,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Old Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Filter by last updated' }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Older than 3 days/ }))

        expect(screen.queryByText(/Recent Task/)).not.toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()
    })

    it('filters sessions older than 1 day when the 1d window is selected', () => {
        const DAY = 24 * 60 * 60 * 1000
        render(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'recent',
                        updatedAt: Date.now() - 12 * 60 * 60 * 1000,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Recent Task' },
                    }),
                    makeSession({
                        id: 'old',
                        updatedAt: Date.now() - 2 * DAY,
                        metadata: { path: '/repo', machineId: 'machine-1', flavor: 'codex', name: 'Old Task' },
                    }),
                ]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'MacBook' }}
            />
        )

        expect(screen.getByText(/Recent Task/)).toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Filter by last updated' }))
        fireEvent.click(screen.getByRole('menuitemradio', { name: /Older than 1 day/ }))

        expect(screen.queryByText(/Recent Task/)).not.toBeInTheDocument()
        expect(screen.getByText(/Old Task/)).toBeInTheDocument()
    })
})
