import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
                'sessions.group.showLess': 'Show less',
                'machine.unknown': 'Unknown machine',
                'session.time.justNow': 'just now',
            }
            return map[key] ?? key
        },
    }),
}))

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
