import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import FilesPage from './files'

const goBackMock = vi.fn()
const useSessionMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => ({})
}))

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn()
    })
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: null
    })
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => useSessionMock()
}))

vi.mock('@/hooks/queries/useGitStatusFiles', () => ({
    useGitStatusFiles: () => ({
        status: null,
        error: null,
        isLoading: false,
        refetch: vi.fn()
    })
}))

vi.mock('@/hooks/queries/useSessionFileSearch', () => ({
    useSessionFileSearch: () => ({
        files: [],
        error: null,
        isLoading: false
    })
}))

vi.mock('@/components/SessionFiles/DirectoryTree', () => ({
    DirectoryTree: () => <div data-testid="directory-tree" />
}))

function renderWithProviders() {
    return render(
        <I18nProvider>
            <FilesPage />
        </I18nProvider>
    )
}

describe('FilesPage stale session recovery', () => {
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
