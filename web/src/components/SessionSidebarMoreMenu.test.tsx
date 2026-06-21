import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionSidebarMoreMenu } from './SessionSidebarMoreMenu'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'session.more': 'More actions',
                'browse.nav': 'Browse',
                'sessions.manage': 'Manage sessions',
                'settings.title': 'Settings',
                'sessions.cleanupInactive': 'Clear inactive sessions',
                'sessions.new': 'New Session',
            }
            return map[key] ?? key
        },
    }),
}))

function renderMenu(overrides: Partial<Parameters<typeof SessionSidebarMoreMenu>[0]> = {}) {
    const props = {
        isDeleteDisabled: false,
        onBrowse: vi.fn(),
        onManageSessions: vi.fn(),
        onSettings: vi.fn(),
        onCleanupInactive: vi.fn(),
        onNewSession: vi.fn(),
        ...overrides,
    }

    render(<SessionSidebarMoreMenu {...props} />)
    return props
}

describe('SessionSidebarMoreMenu', () => {
    afterEach(() => {
        cleanup()
    })

    it('shows the mobile-only session list actions inside the more menu', () => {
        renderMenu()

        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

        expect(screen.getByRole('menuitem', { name: 'Browse' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Manage sessions' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Clear inactive sessions' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'New Session' })).toBeInTheDocument()
    })

    it('runs an action and closes the menu', () => {
        const props = renderMenu()

        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'New Session' }))

        expect(props.onNewSession).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('keeps cleanup disabled when there is nothing to delete', () => {
        const props = renderMenu({ isDeleteDisabled: true })

        fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Clear inactive sessions' }))

        expect(props.onCleanupInactive).not.toHaveBeenCalled()
    })
})
