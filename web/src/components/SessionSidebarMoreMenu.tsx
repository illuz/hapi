import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/use-translation'

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

function FolderOpenIcon(props: { className?: string }) {
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
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function SettingsIcon(props: { className?: string }) {
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
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

function LayoutIcon(props: { className?: string }) {
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
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
            <path d="M9 12h12" />
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

export function SessionSidebarMoreMenu(props: {
    isDeleteDisabled: boolean
    onBrowse: () => void
    onManageSessions: () => void
    onSettings: () => void
    onCleanupInactive: () => void
    onNewSession: () => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!open) return

        const closeMenu = () => setOpen(false)
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
            closeMenu()
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMenu()
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    const handleAction = (action: () => void) => {
        setOpen(false)
        action()
    }

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                aria-haspopup="menu"
                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                title={t('session.more')}
            >
                <MoreVerticalIcon className="h-5 w-5" />
                <span className="sr-only">{t('session.more')}</span>
            </button>

            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label={t('session.more')}
                    className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleAction(props.onBrowse)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        <FolderOpenIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        {t('browse.nav')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleAction(props.onSettings)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        <SettingsIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        {t('settings.title')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleAction(props.onManageSessions)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        <LayoutIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        {t('sessions.manage')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleAction(props.onCleanupInactive)}
                        disabled={props.isDeleteDisabled}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <TrashIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        {t('sessions.cleanupInactive')}
                    </button>
                    <div className="h-px bg-[var(--app-border)]" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleAction(props.onNewSession)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        <PlusIcon className="h-4 w-4 shrink-0" />
                        {t('sessions.new')}
                    </button>
                </div>
            )}
        </div>
    )
}
