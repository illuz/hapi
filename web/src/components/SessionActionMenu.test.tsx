import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionActionMenu } from './SessionActionMenu'

const { mockCopyToClipboard, mockHaptic } = vi.hoisted(() => ({
    mockCopyToClipboard: vi.fn(),
    mockHaptic: {
        impact: vi.fn(),
        notification: vi.fn(),
        selection: vi.fn()
    }
}))

vi.mock('@/lib/clipboard', () => ({
    safeCopyToClipboard: mockCopyToClipboard,
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTelegram: false,
        isTouch: false,
        haptic: mockHaptic,
    }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'session.more': 'More',
                'session.action.marker': 'Marker',
                'session.action.setMarker': 'Set marker',
                'session.action.clearMarker': 'Clear marker',
                'session.action.pin': 'Pin to top',
                'session.action.unpin': 'Unpin from top',
                'session.action.rename': 'Rename',
                'session.action.copyResumeCommand': 'Copy resume command',
                'session.action.fork': 'Fork',
                'session.action.newSession': 'New session',
                'session.action.newSessionCx': 'New session',
                'session.action.newSessionCl': 'New session',
                'session.action.archive': 'Archive',
                'session.action.delete': 'Delete',
                'session.marker.red': 'Red',
                'session.marker.orange': 'Orange',
                'session.marker.yellow': 'Yellow',
                'session.marker.green': 'Green',
                'session.marker.blue': 'Blue',
                'session.marker.purple': 'Purple',
            }
            return map[key] ?? key
        },
    }),
}))

describe('SessionActionMenu', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        vi.clearAllMocks()
        mockCopyToClipboard.mockResolvedValue(undefined)
    })

    it('copies the complete resume command from the right-click menu', async () => {
        const onClose = vi.fn()

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                sessionActive={false}
                resumeCommand="codex resume codex-thread-123"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy resume command' }))

        await waitFor(() => {
            expect(mockCopyToClipboard).toHaveBeenCalledWith('codex resume codex-thread-123')
        })
        expect(mockHaptic.notification).toHaveBeenCalledWith('success')
        expect(onClose).toHaveBeenCalled()
    })

    it('handles copy errors gracefully', async () => {
        const onClose = vi.fn()
        mockCopyToClipboard.mockRejectedValueOnce(new Error('denied'))

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                sessionActive={false}
                resumeCommand="codex resume codex-thread-123"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy resume command' }))

        await waitFor(() => {
            expect(mockCopyToClipboard).toHaveBeenCalledWith('codex resume codex-thread-123')
        })
        expect(mockHaptic.notification).toHaveBeenCalledWith('error')
        expect(onClose).toHaveBeenCalled()
    })

    it('does not expose the HAPI session ID when the agent session ID is unavailable', () => {
        render(
            <SessionActionMenu
                isOpen
                onClose={vi.fn()}
                sessionActive={false}
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        expect(screen.queryByRole('menuitem', { name: 'Copy resume command' })).not.toBeInTheDocument()
        expect(mockCopyToClipboard).not.toHaveBeenCalled()
    })

    it('toggles pin state from the menu', () => {
        const onClose = vi.fn()
        const onTogglePinned = vi.fn()

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                sessionActive={false}
                pinned={false}
                onTogglePinned={onTogglePinned}
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }))
        expect(onTogglePinned).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('renders Codex and Claude new-session actions', async () => {
        const onClose = vi.fn()
        const onSpawnSessionFromConfig = vi.fn().mockResolvedValue(undefined)

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                canSpawnSessionFromConfig
                sessionActive={false}
                resumeCommand="codex resume codex-thread-123"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onSpawnSessionFromConfig={onSpawnSessionFromConfig}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        const items = screen.getAllByRole('menuitem', { name: 'New session' })

        // Cx is the first, Cl is the second
        fireEvent.click(items[0])

        await waitFor(() => {
            expect(onSpawnSessionFromConfig).toHaveBeenCalledWith('codex')
        })
        expect(onClose).toHaveBeenCalled()

        onClose.mockClear()
        onSpawnSessionFromConfig.mockClear()
        cleanup()

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                canSpawnSessionFromConfig
                sessionActive={false}
                resumeCommand="codex resume codex-thread-456"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                onSpawnSessionFromConfig={onSpawnSessionFromConfig}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        const items2 = screen.getAllByRole('menuitem', { name: 'New session' })
        fireEvent.click(items2[1])

        await waitFor(() => {
            expect(onSpawnSessionFromConfig).toHaveBeenCalledWith('claude')
        })
        expect(onClose).toHaveBeenCalled()
    })
})
