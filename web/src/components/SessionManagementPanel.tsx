import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionMarkerColor, SessionSummary } from '@/types/api'
import { SESSION_MARKER_COLORS } from '@/lib/sessionMarkers'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { SessionMarkerMenu } from '@/components/SessionMarkerMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import {
    normalizeSessionManagementSearch,
    SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS,
    type SessionManagementUpdateWindowKey,
    sessionMatchesManagementMarkerColor,
    sessionMatchesManagementQuery,
    sessionMatchesManagementUpdateWindow
} from '@/lib/sessionManagementFilters'
import { clearMessageWindow } from '@/lib/message-window-store'
import { queryKeys } from '@/lib/query-keys'
import { getDisplaySessionTitle } from '@/lib/sessionTitle'

type SessionManagementStatusFilter = 'all' | 'active' | 'inactive'
type BulkActionKind = 'archive' | 'delete' | 'markerColor' | null

function BackIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function matchesStatusFilter(session: SessionSummary, status: SessionManagementStatusFilter): boolean {
    if (status === 'all') return true
    return status === 'active' ? session.active : !session.active
}

function normalizeTimestamp(value: number): number {
    return value < 1_000_000_000_000 ? value * 1000 : value
}

function formatUpdatedAt(value: number): string {
    const timestamp = normalizeTimestamp(value)
    if (!Number.isFinite(timestamp)) return '—'
    return new Date(timestamp).toLocaleString()
}

export function SessionManagementPanel(props: {
    api: ApiClient | null
    sessions: SessionSummary[]
    machineLabelsById: Record<string, string>
    isLoading: boolean
    onClose: () => void
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const [searchQuery, setSearchQuery] = useState('')
    const [markerColorFilter, setMarkerColorFilter] = useState<SessionMarkerColor | null>(null)
    const [updateWindow, setUpdateWindow] = useState<SessionManagementUpdateWindowKey | null>(null)
    const [statusFilter, setStatusFilter] = useState<SessionManagementStatusFilter>('all')
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [pendingAction, setPendingAction] = useState<BulkActionKind>(null)
    const [confirmAction, setConfirmAction] = useState<BulkActionKind>(null)
    const [markerMenuOpen, setMarkerMenuOpen] = useState(false)
    const [markerMenuAnchorPoint, setMarkerMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const markerMenuId = useId()
    const actionToastRef = useRef<{ title: string; body: string; kind?: 'failure' | 'ready' } | null>(null)

    const normalizedQuery = useMemo(
        () => normalizeSessionManagementSearch(searchQuery),
        [searchQuery]
    )

    useEffect(() => {
        const sessionIds = new Set(props.sessions.map((session) => session.id))
        setSelectedIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => sessionIds.has(id)))
            return next.size === previous.size ? previous : next
        })
    }, [props.sessions])

    const resolveMachineLabel = (machineId: string | null | undefined): string => {
        if (machineId && props.machineLabelsById[machineId]) {
            return props.machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const visibleSessions = useMemo(
        () => props.sessions.filter((session) =>
            matchesStatusFilter(session, statusFilter)
            && sessionMatchesManagementMarkerColor(session, markerColorFilter)
            && sessionMatchesManagementUpdateWindow(session, updateWindow)
            && sessionMatchesManagementQuery(
                session,
                normalizedQuery,
                resolveMachineLabel(session.metadata?.machineId)
            )
        ),
        [props.sessions, statusFilter, markerColorFilter, updateWindow, normalizedQuery] // eslint-disable-line react-hooks/exhaustive-deps
    )

    const selectedSessions = useMemo(
        () => props.sessions.filter((session) => selectedIds.has(session.id)),
        [props.sessions, selectedIds]
    )

    const selectedMarkerColor = useMemo(() => {
        if (selectedSessions.length === 0) return null
        const candidate = selectedSessions[0].markerColor ?? null
        return selectedSessions.every((session) => (session.markerColor ?? null) === candidate)
            ? candidate
            : null
    }, [selectedSessions])

    const visibleSessionIds = useMemo(
        () => visibleSessions.map((session) => session.id),
        [visibleSessions]
    )

    const selectedVisibleCount = useMemo(
        () => visibleSessionIds.filter((id) => selectedIds.has(id)).length,
        [visibleSessionIds, selectedIds]
    )

    const activeSelectedCount = useMemo(
        () => selectedSessions.filter((session) => session.active).length,
        [selectedSessions]
    )

    const inactiveSelectedCount = useMemo(
        () => selectedSessions.filter((session) => !session.active).length,
        [selectedSessions]
    )

    const allVisibleSelected = visibleSessionIds.length > 0 && selectedVisibleCount === visibleSessionIds.length
    const hasSelection = selectedIds.size > 0

    const toggleSelected = (sessionId: string) => {
        setSelectedIds((previous) => {
            const next = new Set(previous)
            if (next.has(sessionId)) {
                next.delete(sessionId)
            } else {
                next.add(sessionId)
            }
            return next
        })
    }

    const selectVisibleSessions = () => {
        setSelectedIds((previous) => {
            const next = new Set(previous)
            for (const sessionId of visibleSessionIds) {
                next.add(sessionId)
            }
            return next
        })
    }

    const clearVisibleSelection = () => {
        setSelectedIds((previous) => {
            const next = new Set(previous)
            for (const sessionId of visibleSessionIds) {
                next.delete(sessionId)
            }
            return next
        })
    }

    const clearSelection = () => {
        setSelectedIds(new Set())
    }

    const showSummaryToast = (title: string, body: string, kind: 'failure' | 'ready' = 'ready') => {
        addToast({
            title,
            body,
            sessionId: '',
            url: '',
            kind
        })
    }

    useEffect(() => {
        if (confirmAction !== null) return
        if (!actionToastRef.current) return
        const payload = actionToastRef.current
        actionToastRef.current = null
        showSummaryToast(payload.title, payload.body, payload.kind)
    }, [confirmAction]) // eslint-disable-line react-hooks/exhaustive-deps

    const runBulkArchive = async () => {
        if (!props.api) {
            throw new Error('API unavailable')
        }
        const applicable = selectedSessions.filter((session) => session.active)
        const skippedCount = selectedSessions.length - applicable.length
        if (applicable.length === 0) {
            showSummaryToast(
                t('sessions.manage.bulkArchive'),
                t('sessions.manage.bulkArchive.noneApplicable'),
                'failure'
            )
            return
        }

        setPendingAction('archive')
        try {
            const result = await props.api.archiveSessions(applicable.map((session) => session.id))
            const succeededIds = result.successIds
            const failedCount = result.failed.length

            if (succeededIds.length > 0) {
                setSelectedIds((previous) => {
                    const next = new Set(previous)
                    for (const id of succeededIds) {
                        next.delete(id)
                    }
                    return next
                })
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })

            actionToastRef.current = {
                title: t('sessions.manage.bulkArchive'),
                body: t('sessions.manage.bulkArchive.result', {
                    success: succeededIds.length,
                    skipped: skippedCount + result.skipped.length,
                    failed: failedCount
                }),
                kind: failedCount > 0 ? 'failure' : 'ready'
            }
        } finally {
            setPendingAction(null)
        }
    }

    const runBulkDelete = async () => {
        if (!props.api) {
            throw new Error('API unavailable')
        }
        const applicable = selectedSessions.filter((session) => !session.active)
        const skippedCount = selectedSessions.length - applicable.length
        if (applicable.length === 0) {
            showSummaryToast(
                t('sessions.manage.bulkDelete'),
                t('sessions.manage.bulkDelete.noneApplicable'),
                'failure'
            )
            return
        }

        setPendingAction('delete')
        try {
            const result = await props.api.deleteSessions(applicable.map((session) => session.id))
            const succeededIds = result.successIds
            const failedCount = result.failed.length

            for (const sessionId of succeededIds) {
                queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
                clearMessageWindow(sessionId)
            }

            if (succeededIds.length > 0) {
                setSelectedIds((previous) => {
                    const next = new Set(previous)
                    for (const id of succeededIds) {
                        next.delete(id)
                    }
                    return next
                })
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })

            actionToastRef.current = {
                title: t('sessions.manage.bulkDelete'),
                body: t('sessions.manage.bulkDelete.result', {
                    success: succeededIds.length,
                    skipped: skippedCount + result.skipped.length,
                    failed: failedCount
                }),
                kind: failedCount > 0 ? 'failure' : 'ready'
            }
        } finally {
            setPendingAction(null)
        }
    }

    const runBulkSetMarkerColor = async (markerColor: SessionMarkerColor | null) => {
        if (!props.api) {
            throw new Error('API unavailable')
        }
        if (selectedSessions.length === 0) {
            showSummaryToast(
                t('sessions.manage.bulkSetMarkerColor'),
                t('sessions.manage.bulkSetMarkerColor.noneApplicable'),
                'failure'
            )
            return
        }

        setPendingAction('markerColor')
        try {
            const result = await props.api.setSessionsMarkerColor(
                selectedSessions.map((session) => session.id),
                markerColor
            )
            const failedCount = result.failed.length

            if (failedCount < selectedSessions.length) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            }

            showSummaryToast(
                t('sessions.manage.bulkSetMarkerColor'),
                t('sessions.manage.bulkSetMarkerColor.result', {
                    success: result.successIds.length,
                    failed: failedCount
                }),
                failedCount > 0 ? 'failure' : 'ready'
            )
        } finally {
            setPendingAction(null)
        }
    }

    const confirmCount = confirmAction === 'archive'
        ? activeSelectedCount
        : confirmAction === 'delete'
            ? inactiveSelectedCount
            : 0

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--app-fg)]">
                            {t('sessions.manage')}
                        </div>
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('sessions.manage.summary', {
                                visible: visibleSessions.length,
                                total: props.sessions.length,
                                selected: selectedIds.size
                            })}
                        </div>
                    </div>
                </div>
            </div>

            <div className="app-scroll-y flex-1 min-h-0 p-3">
                <div className="mx-auto flex w-full max-w-content flex-col gap-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={t('sessions.search.placeholder')}
                            data-filter-input="primary"
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)]"
                        />

                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value as SessionManagementStatusFilter)}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors focus:border-[var(--app-link)]"
                        >
                            <option value="all">{t('sessions.manage.status.all')}</option>
                            <option value="active">{t('sessions.manage.status.active')}</option>
                            <option value="inactive">{t('sessions.manage.status.inactive')}</option>
                        </select>

                        <select
                            value={markerColorFilter ?? ''}
                            onChange={(event) => setMarkerColorFilter((event.target.value || null) as SessionMarkerColor | null)}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors focus:border-[var(--app-link)]"
                        >
                            <option value="">{t('sessions.colorFilter.all')}</option>
                            {SESSION_MARKER_COLORS.map((color) => (
                                <option key={color} value={color}>
                                    {t(`session.marker.${color}`)}
                                </option>
                            ))}
                        </select>

                        <select
                            value={updateWindow ?? ''}
                            onChange={(event) => setUpdateWindow((event.target.value || null) as SessionManagementUpdateWindowKey | null)}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors focus:border-[var(--app-link)]"
                        >
                            <option value="">{t('sessions.timeFilter.all')}</option>
                            {SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>
                                    {t(`sessions.timeFilter.${option.key}`)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2">
                        <button
                            type="button"
                            onClick={allVisibleSelected ? clearVisibleSelection : selectVisibleSessions}
                            disabled={visibleSessions.length === 0}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {allVisibleSelected
                                ? t('sessions.manage.clearVisible')
                                : t('sessions.manage.selectVisible', { count: visibleSessions.length })}
                        </button>
                        <button
                            type="button"
                            onClick={clearSelection}
                            disabled={!hasSelection}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {t('sessions.manage.clearSelection')}
                        </button>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={(event) => {
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    setMarkerMenuAnchorPoint({
                                        x: rect.left + (rect.width / 2),
                                        y: rect.bottom
                                    })
                                    setMarkerMenuOpen((open) => !open)
                                }}
                                disabled={!hasSelection || pendingAction !== null}
                                aria-haspopup="menu"
                                aria-expanded={markerMenuOpen}
                                aria-controls={markerMenuOpen ? markerMenuId : undefined}
                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('sessions.manage.bulkSetMarkerColor')} ({selectedIds.size})
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmAction('archive')}
                                disabled={activeSelectedCount === 0 || pendingAction !== null}
                                className="rounded-lg bg-[var(--app-button)] px-3 py-1.5 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('sessions.manage.bulkArchive')} ({activeSelectedCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmAction('delete')}
                                disabled={inactiveSelectedCount === 0 || pendingAction !== null}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('sessions.manage.bulkDelete')} ({inactiveSelectedCount})
                            </button>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]">
                        <div className="hidden grid-cols-[auto_minmax(0,2fr)_minmax(0,1.1fr)_auto_auto] gap-3 border-b border-[var(--app-border)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--app-hint)] md:grid">
                            <div>{t('sessions.manage.column.select')}</div>
                            <div>{t('sessions.manage.column.session')}</div>
                            <div>{t('sessions.manage.column.path')}</div>
                            <div>{t('sessions.manage.column.status')}</div>
                            <div>{t('sessions.manage.column.updatedAt')}</div>
                        </div>

                        {visibleSessions.length === 0 ? (
                            <div className="px-4 py-10 text-center text-sm text-[var(--app-hint)]">
                                {t('sessions.manage.empty')}
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-border)]">
                                {visibleSessions.map((session) => {
                                    const machineLabel = resolveMachineLabel(session.metadata?.machineId)
                                    const selected = selectedIds.has(session.id)
                                    const statusLabel = session.active
                                        ? t('sessions.manage.status.active')
                                        : t('sessions.manage.status.inactive')
                                    const statusClass = session.active
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'

                                    return (
                                        <div
                                            key={session.id}
                                            className={`grid gap-3 px-3 py-3 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1.1fr)_auto_auto] ${selected ? 'bg-[var(--app-subtle-bg)]' : ''}`}
                                        >
                                            <div className="flex items-start pt-1">
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleSelected(session.id)}
                                                    aria-label={t('sessions.manage.selectSession', { name: getDisplaySessionTitle(session) })}
                                                    className="h-4 w-4 rounded border-[var(--app-border)] text-[var(--app-link)] focus:ring-[var(--app-link)]"
                                                />
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate({
                                                            to: '/sessions/$sessionId',
                                                            params: { sessionId: session.id }
                                                        })}
                                                        className="truncate text-left text-sm font-medium text-[var(--app-fg)] hover:text-[var(--app-link)]"
                                                    >
                                                        {getDisplaySessionTitle(session)}
                                                    </button>
                                                    {session.markerColor ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[11px] text-[var(--app-hint)]">
                                                            <SessionMarkerDot markerColor={session.markerColor} size={8} />
                                                            {t(`session.marker.${session.markerColor}`)}
                                                        </span>
                                                    ) : null}
                                                    {session.metadata?.flavor ? (
                                                        <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[11px] text-[var(--app-hint)]">
                                                            {session.metadata.flavor}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                                                    <span>{machineLabel}</span>
                                                    {session.pendingRequestsCount > 0 ? (
                                                        <span>{t('session.item.pending')} {session.pendingRequestsCount}</span>
                                                    ) : null}
                                                    {session.thinking ? (
                                                        <span>{t('session.item.thinking')}</span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-2 text-xs text-[var(--app-hint)] md:hidden">
                                                    {session.metadata?.path ?? session.id}
                                                </div>
                                            </div>

                                            <div className="hidden min-w-0 text-sm text-[var(--app-hint)] md:block">
                                                <div className="truncate">{session.metadata?.path ?? session.id}</div>
                                            </div>

                                            <div className="flex items-start md:justify-center">
                                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                                                    {statusLabel}
                                                </span>
                                            </div>

                                            <div className="text-xs text-[var(--app-hint)] md:text-right">
                                                {formatUpdatedAt(session.updatedAt)}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ConfirmDialog
                isOpen={confirmAction === 'archive'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.manageArchive.title')}
                description={t('dialog.manageArchive.description', { count: confirmCount })}
                confirmLabel={t('dialog.manageArchive.confirm')}
                confirmingLabel={t('dialog.manageArchive.confirming')}
                onConfirm={runBulkArchive}
                isPending={pendingAction === 'archive'}
            />

            <ConfirmDialog
                isOpen={confirmAction === 'delete'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.manageDelete.title')}
                description={t('dialog.manageDelete.description', { count: confirmCount })}
                confirmLabel={t('dialog.manageDelete.confirm')}
                confirmingLabel={t('dialog.manageDelete.confirming')}
                onConfirm={runBulkDelete}
                isPending={pendingAction === 'delete'}
                destructive
            />

            <SessionMarkerMenu
                isOpen={markerMenuOpen}
                onClose={() => setMarkerMenuOpen(false)}
                anchorPoint={markerMenuAnchorPoint}
                markerColor={selectedMarkerColor}
                onSelectMarkerColor={(markerColor) => {
                    void runBulkSetMarkerColor(markerColor)
                }}
                menuId={markerMenuId}
            />
        </div>
    )
}
