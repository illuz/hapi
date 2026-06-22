import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { Spinner } from '@/components/Spinner'
import { CopyIcon, ShareIcon } from '@/components/icons'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { SESSION_MARKER_COLORS } from '@/lib/sessionMarkers'
import { useTranslation } from '@/lib/use-translation'
import { usePlatform } from '@/hooks/usePlatform'
import type { AgentFlavor, SessionMarkerColor } from '@/types/api'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    canForkSession?: boolean
    canSpawnSessionFromConfig?: boolean
    sessionActive: boolean
    sessionId: string
    markerColor: SessionMarkerColor | null
    onSelectMarkerColor: (markerColor: SessionMarkerColor | null) => void
    onRename: () => void
    onShare?: () => void
    onArchive: () => void
    onDelete: () => void
    onForkSession?: () => void | Promise<void>
    onSpawnSessionFromConfig?: (agent: Extract<AgentFlavor, 'claude' | 'codex'>) => void | Promise<void>
    anchorPoint: { x: number; y: number }
    menuId?: string
}

function EditIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    )
}

function ArchiveIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    )
}

function ForkIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 3H5a2 2 0 0 0-2 2v4" />
            <path d="M3 5l7 7" />
            <path d="M21 12v7a2 2 0 0 1-2 2h-7" />
            <path d="M14 14l7 7" />
            <path d="M14 5h7v7" />
            <path d="M21 5l-7 7" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
    )
}

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        canForkSession = false,
        canSpawnSessionFromConfig = false,
        sessionActive,
        sessionId,
        markerColor,
        onSelectMarkerColor,
        onRename,
        onShare,
        onArchive,
        onDelete,
        onForkSession,
        onSpawnSessionFromConfig,
        anchorPoint,
        menuId
    } = props
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
    const [pendingAction, setPendingAction] = useState<'fork' | 'spawn-codex' | 'spawn-claude' | null>(null)
    const { haptic } = usePlatform()
    const internalId = useId()
    const resolvedMenuId = menuId ?? `session-action-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    const handleRename = () => {
        onClose()
        onRename()
    }

    const handleArchive = () => {
        onClose()
        onArchive()
    }

    const handleShare = () => {
        onClose()
        onShare?.()
    }

    const handleDelete = () => {
        onClose()
        onDelete()
    }

    const handleForkSession = async () => {
        if (!onForkSession || pendingAction) {
            return
        }
        setPendingAction('fork')
        try {
            await onForkSession()
        } finally {
            setPendingAction(null)
            onClose()
        }
    }

    const handleSpawnSessionFromConfig = async (agent: Extract<AgentFlavor, 'claude' | 'codex'>) => {
        if (!onSpawnSessionFromConfig || pendingAction) {
            return
        }
        const action = agent === 'codex' ? 'spawn-codex' : 'spawn-claude'
        setPendingAction(action)
        try {
            await onSpawnSessionFromConfig(agent)
        } finally {
            setPendingAction(null)
            onClose()
        }
    }

    const handleCopySessionId = async () => {
        try {
            await safeCopyToClipboard(sessionId)
            haptic.notification('success')
        } catch {
            haptic.notification('error')
        } finally {
            onClose()
        }
    }

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - anchorPoint.y
        const spaceAbove = anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? anchorPoint.y - menuRect.height - gap : anchorPoint.y + gap
        let left = anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [anchorPoint])

    useLayoutEffect(() => {
        if (!isOpen) return
        updatePosition()
    }, [isOpen, updatePosition])

    useEffect(() => {
        if (!isOpen) {
            setMenuPosition(null)
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [isOpen, onClose, updatePosition])

    useEffect(() => {
        if (!isOpen) return

        const frame = window.requestAnimationFrame(() => {
            const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
            firstItem?.focus()
        })

        return () => window.cancelAnimationFrame(frame)
    }, [isOpen])

    if (!isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    const baseItemClassName =
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50'

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[220px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.more')}
            </div>
            <div
                id={resolvedMenuId}
                role="menu"
                aria-labelledby={headingId}
                className="flex flex-col gap-1"
            >
                <div className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('session.action.marker')}
                </div>
                <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                    {SESSION_MARKER_COLORS.map((color) => (
                        <button
                            key={color}
                            type="button"
                            role="menuitemradio"
                            aria-checked={markerColor === color}
                            disabled={pendingAction !== null}
                            className={`flex items-center justify-center gap-2 rounded-md px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${markerColor === color ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            onClick={() => {
                                onClose()
                                onSelectMarkerColor(color)
                            }}
                            title={t(`session.marker.${color}`)}
                        >
                            <SessionMarkerDot markerColor={color} size={10} />
                            <span>{t(`session.marker.${color}`)}</span>
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    role="menuitem"
                    disabled={pendingAction !== null}
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={() => {
                        onClose()
                        onSelectMarkerColor(null)
                    }}
                >
                    <span className="inline-block h-[10px] w-[10px] rounded-full border border-[var(--app-divider)]" aria-hidden="true" />
                    {t('session.action.clearMarker')}
                </button>

                <button
                    type="button"
                    role="menuitem"
                    disabled={pendingAction !== null}
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={handleRename}
                >
                    <EditIcon className="text-[var(--app-hint)]" />
                    {t('session.action.rename')}
                </button>

                <button
                    type="button"
                    role="menuitem"
                    disabled={pendingAction !== null}
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={handleCopySessionId}
                >
                    <CopyIcon className="h-[18px] w-[18px] text-[var(--app-hint)]" />
                    {t('session.action.copyId')}
                </button>

                {onShare ? (
                    <button
                        type="button"
                        role="menuitem"
                        disabled={pendingAction !== null}
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleShare}
                    >
                        <ShareIcon className="h-[18px] w-[18px] text-[var(--app-hint)]" />
                        {t('session.action.share')}
                    </button>
                ) : null}

                {canForkSession ? (
                    <button
                        type="button"
                        role="menuitem"
                        disabled={pendingAction !== null}
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleForkSession}
                    >
                        {pendingAction === 'fork' ? (
                            <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                        ) : (
                            <ForkIcon className="text-[var(--app-hint)]" />
                        )}
                        <span>{t('session.action.fork')}</span>
                    </button>
                ) : null}

                {canSpawnSessionFromConfig ? (
                    <>
                        <button
                            type="button"
                            role="menuitem"
                            disabled={pendingAction !== null}
                            className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                            onClick={() => { void handleSpawnSessionFromConfig('codex') }}
                        >
                            {pendingAction === 'spawn-codex' ? (
                                <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                            ) : (
                                <PlusIcon className="text-[var(--app-hint)]" />
                            )}
                            <span className="flex-1">{t('session.action.newSessionCx')}</span>
                            <span aria-hidden="true" className="inline-flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none bg-[#ef4444] text-white h-4 w-4 shrink-0">Cx</span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            disabled={pendingAction !== null}
                            className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                            onClick={() => { void handleSpawnSessionFromConfig('claude') }}
                        >
                            {pendingAction === 'spawn-claude' ? (
                                <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                            ) : (
                                <PlusIcon className="text-[var(--app-hint)]" />
                            )}
                            <span className="flex-1">{t('session.action.newSessionCl')}</span>
                            <span aria-hidden="true" className="inline-flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none bg-[#d97706] text-white h-4 w-4 shrink-0">Cl</span>
                        </button>
                    </>
                ) : null}

                {sessionActive ? (
                    <button
                        type="button"
                        role="menuitem"
                        disabled={pendingAction !== null}
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleArchive}
                    >
                        <ArchiveIcon className="text-red-500" />
                        {t('session.action.archive')}
                    </button>
                ) : (
                    <button
                        type="button"
                        role="menuitem"
                        disabled={pendingAction !== null}
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleDelete}
                    >
                        <TrashIcon className="text-red-500" />
                        {t('session.action.delete')}
                    </button>
                )}
            </div>
        </div>
    )
}
