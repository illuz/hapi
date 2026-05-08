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
                'session.action.rename': 'Rename',
                'session.action.copyId': 'Copy ID',
                'session.action.fork': 'Fork',
                'session.action.newSession': 'New session',
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

    it('copies the session ID from the right-click menu', async () => {
        const onClose = vi.fn()

        render(
            <SessionActionMenu
                isOpen
                onClose={onClose}
                sessionActive={false}
                sessionId="session-123"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy ID' }))

        await waitFor(() => {
            expect(mockCopyToClipboard).toHaveBeenCalledWith('session-123')
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
                sessionId="session-123"
                markerColor={null}
                onSelectMarkerColor={vi.fn()}
                onRename={vi.fn()}
                onArchive={vi.fn()}
                onDelete={vi.fn()}
                anchorPoint={{ x: 100, y: 100 }}
            />,
        )

        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy ID' }))

        await waitFor(() => {
            expect(mockCopyToClipboard).toHaveBeenCalledWith('session-123')
        })
        expect(mockHaptic.notification).toHaveBeenCalledWith('error')
        expect(onClose).toHaveBeenCalled()
    })
})
