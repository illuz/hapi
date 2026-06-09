import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { AgentFlavor, Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { usePlatform } from '@/hooks/usePlatform'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { SessionMarkerMenu } from '@/components/SessionMarkerMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { canForkSession, canSpawnSessionFromConfig } from '@/lib/sessionBranching'
import { getSessionModelLabel } from '@/lib/sessionModelLabel'
import { getSessionMarkerColorHex } from '@/lib/sessionMarkers'
import { loadSessionColorFilterPreference } from '@/lib/sessionColorFilterPreference'
import { getDisplaySessionTitle, getSessionTitle } from '@/lib/sessionTitle'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

function FilesIcon(props: { className?: string }) {
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function HistoryIcon(props: { className?: string }) {
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
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l3 2" />
        </svg>
    )
}

function OutlineIcon(props: { className?: string }) {
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
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
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

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    onOpenOutline?: () => void
    onOpenHistory?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
    autoContinueButton?: ReactNode
}) {
    const { t } = useTranslation()
    const { session, api, onSessionDeleted } = props
    const navigate = useNavigate()
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const title = useMemo(() => getSessionTitle(session), [session])
    const displayTitle = useMemo(() => getDisplaySessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const modelLabel = getSessionModelLabel(session)
    const markerTextColor = getSessionMarkerColorHex(session.markerColor)
    const forkSupported = canForkSession(session)
    const spawnFromConfigSupported = canSpawnSessionFromConfig(session)

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [markerMenuOpen, setMarkerMenuOpen] = useState(false)
    const [markerMenuAnchorPoint, setMarkerMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const markerMenuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const markerAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const {
        archiveSession,
        renameSession,
        setSessionMarkerColor,
        deleteSession,
        forkSession,
        spawnSessionFromConfig,
        isPending
    } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const showActionError = (title: string, error: unknown) => {
        addToast({
            title,
            body: error instanceof Error ? error.message : t('dialog.error.default'),
            sessionId: session.id,
            url: `/sessions/${session.id}`,
            kind: 'failure'
        })
    }

    const handleForkSession = async () => {
        try {
            const result = await forkSession()
            const inheritedMarkerColor = loadSessionColorFilterPreference()
            if (inheritedMarkerColor) {
                await api?.setSessionMarkerColor(result.sessionId, inheritedMarkerColor)
            }
            haptic.notification('success')
            await navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        } catch (error) {
            haptic.notification('error')
            showActionError(t('session.action.fork'), error)
        }
    }

    const handleSpawnSessionFromConfig = async (agent: Extract<AgentFlavor, 'claude' | 'codex'>) => {
        try {
            const result = await spawnSessionFromConfig(agent)
            const inheritedMarkerColor = loadSessionColorFilterPreference()
            if (inheritedMarkerColor) {
                await api?.setSessionMarkerColor(result.sessionId, inheritedMarkerColor)
            }
            haptic.notification('success')
            await navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        } catch (error) {
            haptic.notification('error')
            showActionError(t('session.action.newSession'), error)
        }
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
        setMarkerMenuOpen(false)
    }

    const handleMarkerMenuToggle = () => {
        if (!markerMenuOpen && markerAnchorRef.current) {
            const rect = markerAnchorRef.current.getBoundingClientRect()
            setMarkerMenuAnchorPoint({ x: rect.left + (rect.width / 2), y: rect.bottom })
        }
        setMarkerMenuOpen((open) => !open)
        setMenuOpen(false)
    }

    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto flex w-full max-w-content items-center gap-2 p-3">
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    <div className="min-w-0 flex-1">
                        <div
                            className="truncate font-semibold"
                            style={markerTextColor ? { color: markerTextColor } : undefined}
                        >
                            {displayTitle}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            {modelLabel ? (
                                <span>
                                    {t(modelLabel.key)}: {modelLabel.value}
                                </span>
                            ) : null}
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {props.autoContinueButton ?? null}

                    <button
                        type="button"
                        ref={markerAnchorRef}
                        onClick={handleMarkerMenuToggle}
                        aria-haspopup="menu"
                        aria-expanded={markerMenuOpen}
                        aria-controls={markerMenuOpen ? markerMenuId : undefined}
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${session.markerColor ? 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'}`}
                        title={session.markerColor ? t('session.action.marker') : t('session.action.setMarker')}
                    >
                        {session.markerColor ? (
                            <SessionMarkerDot markerColor={session.markerColor} size={10} />
                        ) : (
                            <span className="inline-block h-[10px] w-[10px] rounded-full border border-[var(--app-divider)]" aria-hidden="true" />
                        )}
                    </button>

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    {props.onOpenHistory ? (
                        <button
                            type="button"
                            onClick={props.onOpenHistory}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.history.open')}
                            aria-label={t('session.history.open')}
                        >
                            <HistoryIcon />
                        </button>
                    ) : null}

                    {props.onOpenOutline ? (
                        <button
                            type="button"
                            onClick={props.onOpenOutline}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.outline.open')}
                            aria-label={t('session.outline.open')}
                        >
                            <OutlineIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionMarkerMenu
                isOpen={markerMenuOpen}
                onClose={() => setMarkerMenuOpen(false)}
                anchorPoint={markerMenuAnchorPoint}
                markerColor={session.markerColor}
                onSelectMarkerColor={(markerColor) => { void setSessionMarkerColor(markerColor) }}
                menuId={markerMenuId}
            />

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                canForkSession={forkSupported}
                canSpawnSessionFromConfig={spawnFromConfigSupported}
                sessionActive={session.active}
                sessionId={session.id}
                markerColor={session.markerColor}
                onSelectMarkerColor={(markerColor) => { void setSessionMarkerColor(markerColor) }}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                onForkSession={handleForkSession}
                onSpawnSessionFromConfig={handleSpawnSessionFromConfig}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )
}
