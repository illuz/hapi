import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import type { ConversationHistoryEntry, Session } from '@/types/api'
import { ConversationHistoryPanel } from './ConversationHistoryPanel'

const entry: ConversationHistoryEntry = {
    id: 'history-1',
    namespace: 'default',
    sessionId: 'session-target',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    createdAt: 1_700_000_000_000,
    title: 'History title',
    projectPath: '/repo',
    projectHost: 'machine',
    markerColor: null,
    userText: 'User prompt',
    assistantExcerpt: 'Assistant response'
}

const session = {
    id: 'session-current',
    namespace: 'default',
    active: true,
    metadata: { path: '/repo', host: 'machine' }
} as Session

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
        getConversationHistory: vi.fn(async () => ({
            entries: [entry],
            page: {
                limit: 50,
                nextBeforeCreatedAt: null,
                nextBeforeId: null,
                hasMore: false
            }
        })),
        getSession: vi.fn(async (sessionId: string) => ({
            session: { ...session, id: sessionId }
        })),
        ...overrides
    } as unknown as ApiClient
}

function renderPanel(api: ApiClient, onOpenSession = vi.fn()) {
    render(
        <I18nProvider>
            <ConversationHistoryPanel
                api={api}
                session={session}
                open
                onClose={vi.fn()}
                onOpenSession={onOpenSession}
            />
        </I18nProvider>
    )
    return { onOpenSession }
}

describe('ConversationHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn(() => 'en'),
                setItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
                key: vi.fn(() => null),
                length: 0
            },
            configurable: true
        })
    })

    afterEach(() => {
        cleanup()
    })

    it('verifies and opens the source session from history detail', async () => {
        const api = createApi()
        const { onOpenSession } = renderPanel(api)

        fireEvent.click(await screen.findByRole('button', { name: 'History title' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Open session' }))

        await waitFor(() => {
            expect(api.getSession).toHaveBeenCalledWith('session-target')
            expect(onOpenSession).toHaveBeenCalledWith('session-target')
        })
    })

    it('shows deleted notice when the source session is gone', async () => {
        const api = createApi({
            getSession: vi.fn(async () => {
                throw new ApiError('HTTP 404 Not Found', 404)
            })
        })
        const { onOpenSession } = renderPanel(api)

        fireEvent.click(await screen.findByRole('button', { name: 'History title' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Open session' }))

        expect(await screen.findByText('This conversation has been deleted.')).toBeInTheDocument()
        expect(onOpenSession).not.toHaveBeenCalled()
    })
})
