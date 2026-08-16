import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Session } from '@/types/api'
import { SessionHeader } from './SessionHeader'

const { mockSessionActionMenu } = vi.hoisted(() => ({
    mockSessionActionMenu: vi.fn(() => null),
}))

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

vi.mock('@/hooks/useTelegram', () => ({
    isTelegramApp: () => false,
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
    SessionActionMenu: mockSessionActionMenu,
}))

vi.mock('@/components/SessionMarkerMenu', () => ({
    SessionMarkerMenu: () => null,
}))

vi.mock('@/components/RenameSessionDialog', () => ({
    RenameSessionDialog: () => null,
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: () => null,
}))

vi.mock('@/lib/toast-context', () => ({
    useToast: () => ({
        addToast: vi.fn(),
    }),
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        markerColor: null,
        metadata: {
            flavor: 'codex',
            codexSessionId: 'codex-thread-1',
            path: '/tmp/hapi',
        },
        messages: [],
        pendingRequests: [],
        activeAt: null,
        model: null,
        effort: null,
        permissionMode: 'default',
        todoProgress: null,
        thinking: false,
        collaborationMode: null,
        ...overrides,
    } as Session
}

describe('SessionHeader', () => {
    it('passes fork and spawn actions through to the shared action menu', () => {
        render(
            <SessionHeader
                session={makeSession()}
                onBack={vi.fn()}
                api={null}
            />,
        )

        expect(mockSessionActionMenu).toHaveBeenCalled()
        const calls = mockSessionActionMenu.mock.calls as unknown as Array<[Record<string, unknown>]>
        const props = calls[calls.length - 1]?.[0]
        if (!props) {
            throw new Error('SessionActionMenu was not rendered with props')
        }

        expect(props.canForkSession).toBe(true)
        expect(props.canSpawnSessionFromConfig).toBe(true)
        expect(props.resumeCommand).toBe('codex resume codex-thread-1')
        expect(props.onForkSession).toEqual(expect.any(Function))
        expect(props.onSpawnSessionFromConfig).toEqual(expect.any(Function))
    })
})
