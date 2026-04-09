import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import TerminalPage from './terminal'

const writeMock = vi.fn()
const goBackMock = vi.fn()
const useSessionMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' })
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: null,
        token: 'test-token',
        baseUrl: 'http://localhost:3000'
    })
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => useSessionMock()
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: () => ({
        state: { status: 'connected' as const },
        connect: vi.fn(),
        write: writeMock,
        resize: vi.fn(),
        disconnect: vi.fn(),
        onOutput: vi.fn(),
        onExit: vi.fn()
    })
}))

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: ({ onClick }: { onClick: () => void }) => ({
        onClick
    })
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="terminal-view" />
}))

function renderWithProviders() {
    return render(
        <I18nProvider>
            <TerminalPage />
        </I18nProvider>
    )
}

describe('TerminalPage paste behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useSessionMock.mockReturnValue({
            session: {
                id: 'session-1',
                active: true,
                metadata: { path: '/tmp/project' }
            },
            isLoading: false,
            isNotFound: false,
            error: null,
            refetch: vi.fn()
        })
    })

    it('does not open manual paste dialog when clipboard text is empty', async () => {
        const readText = vi.fn(async () => '')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })

        renderWithProviders()
        fireEvent.click(screen.getAllByRole('button', { name: 'Paste' })[0])

        await waitFor(() => {
            expect(readText).toHaveBeenCalledTimes(1)
        })
        expect(writeMock).not.toHaveBeenCalled()
        expect(screen.queryByText('Paste input')).not.toBeInTheDocument()
    })

    it('opens manual paste dialog when clipboard read fails', async () => {
        const readText = vi.fn(async () => {
            throw new Error('blocked')
        })
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })

        renderWithProviders()
        fireEvent.click(screen.getAllByRole('button', { name: 'Paste' })[0])

        expect(await screen.findByText('Paste input')).toBeInTheDocument()
    })

    it('shows a recovery state when the session no longer exists', () => {
        useSessionMock.mockReturnValue({
            session: null,
            isLoading: false,
            isNotFound: true,
            error: 'HTTP 404 Not Found: {"error":"Session not found"}',
            refetch: vi.fn()
        })

        renderWithProviders()

        expect(screen.getByText('Session unavailable')).toBeInTheDocument()
        expect(screen.getByText('This session was removed. Return to the session list to continue.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }))
        expect(goBackMock).toHaveBeenCalledTimes(1)
    })
})
