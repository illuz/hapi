import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { AgentFlavor, ProjectToolCounts, SessionMarkerColor, SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ShareSessionDialog } from '@/components/ShareSessionDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { loadSessionColorFilterPreference, saveSessionColorFilterPreference } from '@/lib/sessionColorFilterPreference'
import {
    normalizeSessionManagementSearch,
    SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS,
    sessionMatchesManagementMarkerColor,
    sessionMatchesManagementQuery,
    sessionMatchesManagementUpdateWindow
} from '@/lib/sessionManagementFilters'
import { useSessionAttentionTokens } from '@/lib/sessionAttention'
import { canForkSession, canSpawnSessionFromConfig } from '@/lib/sessionBranching'
import { SESSION_MARKER_COLORS, getSessionMarkerColorHex } from '@/lib/sessionMarkers'
import { getDisplaySessionTitle, getSessionTitle as getBaseSessionTitle } from '@/lib/sessionTitle'
import { useToast } from '@/lib/toast-context'
import { CopyIcon, CheckIcon, ShareIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

type ProjectToolCountsByKey = Record<string, ProjectToolCounts>

export function getProjectToolCountsKey(machineId: string | null, projectPath: string): string | null {
    if (!machineId || !projectPath || projectPath === 'Other') {
        return null
    }
    return `${machineId}::${projectPath}`
}

function SessionsEmptyState(props: {
    onNewSession: () => void
    onBrowse?: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--app-hint)] opacity-60"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 14h8" />
                <path d="M8 17h5" />
            </svg>
            <div className="text-base font-medium text-[var(--app-fg)]">
                {t('sessions.empty.title')}
            </div>
            <div className="max-w-sm text-sm text-[var(--app-hint)]">
                {t('sessions.empty.hint')}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
                >
                    {t('sessions.empty.startSession')}
                </button>
                {props.onBrowse && (
                    <button
                        type="button"
                        onClick={props.onBrowse}
                        className="px-4 py-1.5 text-sm rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('sessions.empty.browse')}
                    </button>
                )}
            </div>
        </div>
    )
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    hasActiveSession: boolean
    latestUpdatedAt: number
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export const UNKNOWN_MACHINE_ID = '__unknown__'
export const GROUP_SESSION_PREVIEW_LIMIT = 8

export function deduplicateSessionsByAgentId(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    const byAgentId = new Map<string, SessionSummary[]>()
    const result: SessionSummary[] = []

    for (const session of sessions) {
        const agentId = session.metadata?.agentSessionId
        if (!agentId) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(agentId)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(agentId, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? UNKNOWN_MACHINE_ID}::${path}`
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: []
            })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = [...group.sessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = group.sessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = group.sessions.some(s => s.active)
            const displayName = getGroupDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUpdatedAt,
                hasActiveSession
            }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}


export function expandSelectedSessionCollapseOverrides(
    overrides: Map<string, boolean>,
    group: { key: string; machineId: string | null }
): Map<string, boolean> {
    const next = new Map(overrides)
    let changed = false

    // Expand project group if collapsed. Project and machine keys use true = collapsed.
    if (overrides.has(group.key) && overrides.get(group.key)) {
        next.delete(group.key)
        changed = true
    }

    // Session preview keys use inverted semantics: false = expanded, true/missing = collapsed.
    const sessionPreviewKey = `sessions::${group.key}`
    if (overrides.get(sessionPreviewKey) !== false) {
        next.set(sessionPreviewKey, false)
        changed = true
    }

    const machineKey = `machine::${group.machineId ?? UNKNOWN_MACHINE_ID}`
    if (overrides.has(machineKey) && overrides.get(machineKey)) {
        next.delete(machineKey)
        changed = true
    }

    return changed ? next : overrides
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    for (const g of groups) {
        const key = g.machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId: g.machineId,
                label: resolveMachineLabel(g.machineId),
                projectGroups: [],
                totalSessions: 0,
                hasActiveSession: false,
                latestUpdatedAt: 0,
            }
            map.set(key, mg)
        }
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.hasActiveSession) mg.hasActiveSession = true
        if (g.latestUpdatedAt > mg.latestUpdatedAt) mg.latestUpdatedAt = g.latestUpdatedAt
    }
    return [...map.values()].sort((a, b) => {
        if (a.hasActiveSession !== b.hasActiveSession) return a.hasActiveSession ? -1 : 1
        return b.latestUpdatedAt - a.latestUpdatedAt
    })
}

function CopyPathButton({ path, className }: { path: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-[var(--app-badge-success-text)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'} ${className ?? ''}`}
            title={copied ? 'Copied!' : `Copy: ${path}`}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5" />
                : <CopyIcon className="h-3.5 w-3.5" />
            }
        </button>
    )
}

function ProjectToolCountButton(props: {
    label: string
    icon: string
    count: number
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="shrink-0 rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-hint)] transition-colors hover:border-[var(--app-link)] hover:text-[var(--app-link)]"
            aria-label={`${props.label} ${props.count}`}
            title={`${props.label}: ${props.count}`}
        >
            <span aria-hidden="true">{props.icon}</span> {props.count}
        </button>
    )
}


function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function MarkerPaletteIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M12 3a9 9 0 0 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3.05 1.8 1.8 0 0 1 1.3-3.05H17a4 4 0 0 0 4-4A8 8 0 0 0 12 3Z" />
            <circle cx="7.7" cy="10" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="7.2" r="0.8" fill="currentColor" stroke="none" />
            <circle cx="14.2" cy="7.8" r="0.8" fill="currentColor" stroke="none" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function ClockIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 16 14" />
        </svg>
    )
}

const UPDATE_WINDOW_OPTIONS = SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS
type UpdateWindowKey = (typeof UPDATE_WINDOW_OPTIONS)[number]['key']


function LoaderIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

export function getSessionTitle(session: SessionSummary): string {
    return getBaseSessionTitle(session)
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

export function normalizeSearch(value: string | null | undefined): string {
    return normalizeSessionManagementSearch(value)
}

export function sessionMatchesQuery(session: SessionSummary, query: string, machineLabel: string): boolean {
    return sessionMatchesManagementQuery(session, query, machineLabel)
}

export function sessionMatchesMarkerColor(
    session: SessionSummary,
    markerColor: SessionMarkerColor | null
): boolean {
    return sessionMatchesManagementMarkerColor(session, markerColor)
}

export function sessionMatchesUpdateWindow(
    session: SessionSummary,
    window: UpdateWindowKey | null
): boolean {
    return sessionMatchesManagementUpdateWindow(session, window)
}

function getMarkerColorCounts(sessions: SessionSummary[]): Record<SessionMarkerColor, number> {
    const counts = {} as Record<SessionMarkerColor, number>
    for (const color of SESSION_MARKER_COLORS) {
        counts[color] = 0
    }

    for (const session of sessions) {
        if (session.markerColor) {
            counts[session.markerColor] += 1
        }
    }

    return counts
}


export function getVisibleSessionPreview(
    sessions: SessionSummary[],
    options: {
        expanded?: boolean
        selectedSessionId?: string | null
        limit?: number
    } = {}
): SessionSummary[] {
    const limit = options.limit ?? GROUP_SESSION_PREVIEW_LIMIT
    if (options.expanded || sessions.length <= limit) return sessions

    const requiredIds = new Set<string>()
    for (const session of sessions) {
        if (session.active) requiredIds.add(session.id)
    }
    if (options.selectedSessionId && sessions.some(session => session.id === options.selectedSessionId)) {
        requiredIds.add(options.selectedSessionId)
    }

    const visible: SessionSummary[] = sessions.filter((session, index) => {
        return index < limit || requiredIds.has(session.id)
    })

    for (let index = visible.length - 1; visible.length > limit && index >= 0; index -= 1) {
        const session = visible[index]
        if (!session || requiredIds.has(session.id)) continue
        visible.splice(index, 1)
    }

    return visible
}

function SessionListSearch(props: {
    value: string
    onChange: (value: string) => void
    markerColorFilter: SessionMarkerColor | null
    markerColorCounts: Record<SessionMarkerColor, number>
    totalCount: number
    onMarkerColorFilterChange: (markerColor: SessionMarkerColor | null) => void
    updateWindow: UpdateWindowKey | null
    updateWindowCounts: Record<UpdateWindowKey, number>
    onUpdateWindowChange: (window: UpdateWindowKey | null) => void
}) {
    const { t } = useTranslation()
    const [menuOpen, setMenuOpen] = useState(false)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [timeMenuOpen, setTimeMenuOpen] = useState(false)
    const timeButtonRef = useRef<HTMLButtonElement | null>(null)
    const timeMenuRef = useRef<HTMLDivElement | null>(null)
    const anyMenuOpen = menuOpen || timeMenuOpen

    useEffect(() => {
        if (!anyMenuOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
            if (timeButtonRef.current?.contains(target) || timeMenuRef.current?.contains(target)) return
            setMenuOpen(false)
            setTimeMenuOpen(false)
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false)
                setTimeMenuOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [anyMenuOpen])

    const selectMarkerColor = (markerColor: SessionMarkerColor | null) => {
        props.onMarkerColorFilterChange(markerColor)
        setMenuOpen(false)
    }

    const selectUpdateWindow = (window: UpdateWindowKey | null) => {
        props.onUpdateWindowChange(window)
        setTimeMenuOpen(false)
    }

    const activeMarkerLabel = props.markerColorFilter
        ? t(`session.marker.${props.markerColorFilter}`)
        : null

    const activeWindowOption = props.updateWindow
        ? UPDATE_WINDOW_OPTIONS.find(option => option.key === props.updateWindow) ?? null
        : null

    return (
        <div className="relative px-3 pb-2">
            <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--app-hint)]">
                        <SearchIcon className="h-3.5 w-3.5" />
                    </div>
                    <input
                        type="search"
                        value={props.value}
                        onChange={(event) => props.onChange(event.target.value)}
                        placeholder={t('sessions.search.placeholder')}
                        data-filter-input="sidebar"
                        className="w-full appearance-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-8 pr-8 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                    />
                    {props.value ? (
                        <button
                            type="button"
                            onClick={() => props.onChange('')}
                            className="absolute inset-y-0 right-2 flex items-center rounded p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                            title={t('sessions.search.clear')}
                        >
                            <XIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>

                <div className="relative shrink-0">
                    <div className="relative">
                        <button
                            ref={buttonRef}
                            type="button"
                            onClick={() => setMenuOpen(open => !open)}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={activeMarkerLabel
                                ? `${t('sessions.colorFilter.title')}: ${activeMarkerLabel}`
                                : t('sessions.colorFilter.title')}
                            title={activeMarkerLabel
                                ? `${t('sessions.colorFilter.title')}: ${activeMarkerLabel}`
                                : t('sessions.colorFilter.title')}
                            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${props.markerColorFilter ? 'border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-link)]' : 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                        >
                            <MarkerPaletteIcon className="h-4 w-4" />
                            {props.markerColorFilter ? (
                                <SessionMarkerDot
                                    markerColor={props.markerColorFilter}
                                    size={7}
                                    className="absolute bottom-1.5 right-1.5"
                                />
                            ) : null}
                        </button>
                        {props.markerColorFilter ? (
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    selectMarkerColor(null)
                                }}
                                className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm ring-1 ring-[var(--app-bg)] transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                aria-label={t('sessions.colorFilter.clear')}
                                title={t('sessions.colorFilter.clear')}
                            >
                                <XIcon className="h-2 w-2" />
                            </button>
                        ) : null}
                    </div>

                    {menuOpen ? (
                        <div
                            ref={menuRef}
                            className="absolute right-0 top-full z-50 mt-1 min-w-[190px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
                            role="menu"
                            aria-label={t('sessions.colorFilter.title')}
                        >
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={props.markerColorFilter === null}
                                onClick={() => selectMarkerColor(null)}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${props.markerColorFilter === null ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            >
                                <MarkerPaletteIcon className="h-3.5 w-3.5" />
                                <span>
                                    {t('sessions.colorFilter.all')}
                                    <span className="ml-1 text-[11px] tabular-nums text-[var(--app-hint)]">({props.totalCount})</span>
                                </span>
                            </button>

                            <div className="my-1 border-t border-[var(--app-divider)]" />

                            {SESSION_MARKER_COLORS.map((markerColor) => {
                                const count = props.markerColorCounts[markerColor]
                                const selected = props.markerColorFilter === markerColor
                                const disabled = count === 0 && !selected

                                return (
                                    <button
                                        key={markerColor}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        disabled={disabled}
                                        onClick={() => selectMarkerColor(markerColor)}
                                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                    >
                                        <SessionMarkerDot markerColor={markerColor} size={10} />
                                        <span>
                                            {t(`session.marker.${markerColor}`)}
                                            <span className="ml-1 text-[11px] tabular-nums text-[var(--app-hint)]">({count})</span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    ) : null}
                </div>

                <div className="relative shrink-0">
                    <div className="relative">
                        <button
                            ref={timeButtonRef}
                            type="button"
                            onClick={() => {
                                setMenuOpen(false)
                                setTimeMenuOpen(open => !open)
                            }}
                            aria-haspopup="menu"
                            aria-expanded={timeMenuOpen}
                            aria-label={activeWindowOption
                                ? `${t('sessions.timeFilter.title')}: ${t(`sessions.timeFilter.${activeWindowOption.key}`)}`
                                : t('sessions.timeFilter.title')}
                            title={activeWindowOption
                                ? `${t('sessions.timeFilter.title')}: ${t(`sessions.timeFilter.${activeWindowOption.key}`)}`
                                : t('sessions.timeFilter.title')}
                            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${props.updateWindow ? 'border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-link)]' : 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                        >
                            <ClockIcon className="h-4 w-4" />
                        </button>
                        {props.updateWindow ? (
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    selectUpdateWindow(null)
                                }}
                                className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm ring-1 ring-[var(--app-bg)] transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                aria-label={t('sessions.timeFilter.clear')}
                                title={t('sessions.timeFilter.clear')}
                            >
                                <XIcon className="h-2 w-2" />
                            </button>
                        ) : null}
                    </div>

                    {timeMenuOpen ? (
                        <div
                            ref={timeMenuRef}
                            className="absolute right-0 top-full z-50 mt-1 min-w-[190px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
                            role="menu"
                            aria-label={t('sessions.timeFilter.title')}
                        >
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={props.updateWindow === null}
                                onClick={() => selectUpdateWindow(null)}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${props.updateWindow === null ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            >
                                <ClockIcon className="h-3.5 w-3.5" />
                                <span>
                                    {t('sessions.timeFilter.all')}
                                    <span className="ml-1 text-[11px] tabular-nums text-[var(--app-hint)]">({props.totalCount})</span>
                                </span>
                            </button>

                            <div className="my-1 border-t border-[var(--app-divider)]" />

                            {UPDATE_WINDOW_OPTIONS.map((option) => {
                                const count = props.updateWindowCounts[option.key]
                                const selected = props.updateWindow === option.key
                                const disabled = count === 0 && !selected

                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={selected}
                                        disabled={disabled}
                                        onClick={() => selectUpdateWindow(option.key)}
                                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                    >
                                        <ClockIcon className="h-3.5 w-3.5" />
                                        <span>
                                            {t(`sessions.timeFilter.${option.key}`)}
                                            <span className="ml-1 text-[11px] tabular-nums text-[var(--app-hint)]">({count})</span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

const FLAVOR_BADGES: Record<string, { label: string; colors: string }> = {
    claude: {
        label: 'Cl',
        colors: 'bg-[#d97706] text-white',
    },
    codex: {
        label: 'Cx',
        colors: 'bg-[#111827] text-white',
    },
    cursor: {
        label: 'Cu',
        colors: 'bg-[#0f766e] text-white',
    },
    gemini: {
        label: 'Gm',
        colors: 'bg-[#2563eb] text-white',
    },
    opencode: {
        label: 'Op',
        colors: 'bg-[#15803d] text-white',
    },
}

function FlavorIcon({ flavor, className }: { flavor?: string | null; className?: string }) {
    const badge = FLAVOR_BADGES[(flavor ?? 'claude').trim().toLowerCase()] ?? FLAVOR_BADGES.claude
    return (
        <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none ${badge.colors} ${className ?? 'h-4 w-4'}`}
        >
            {badge.label}
        </span>
    )
}

function MachineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
    )
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
    attentionToken?: number
}) {
    const { t } = useTranslation()
    const { session: s, onSelect, showPath = true, api, selected = false, attentionToken } = props
    const { haptic } = usePlatform()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [shareOpen, setShareOpen] = useState(false)
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
        s.id,
        s.metadata?.flavor ?? null
    )

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const displaySessionName = getDisplaySessionTitle(s)
    const todoProgress = getTodoProgress(s)
    const markerTextColor = getSessionMarkerColorHex(s.markerColor)
    const forkSupported = canForkSession(s)
    const spawnFromConfigSupported = canSpawnSessionFromConfig(s)

    const showActionError = (title: string, error: unknown) => {
        addToast({
            title,
            body: error instanceof Error ? error.message : t('dialog.error.default'),
            sessionId: s.id,
            url: `/sessions/${s.id}`,
            kind: 'failure'
        })
    }

    const handleForkSession = async () => {
        try {
            const result = await forkSession()
            haptic.notification('success')
            onSelect(result.sessionId)
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
            haptic.notification('success')
            onSelect(result.sessionId)
            await navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        } catch (error) {
            haptic.notification('error')
            showActionError(t('session.action.newSession'), error)
        }
    }

    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item relative flex w-full flex-col gap-1 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
                data-session-id={s.id}
                onContextMenu={(event) => {
                    event.preventDefault()
                    setMenuAnchorPoint({ x: event.clientX, y: event.clientY })
                    setMenuOpen(true)
                }}
            >
                {attentionToken ? (
                    <span
                        key={attentionToken}
                        aria-hidden="true"
                        className="session-list-item-attention pointer-events-none absolute inset-0 z-0 rounded-lg"
                    />
                ) : null}
                <div className="relative z-10 flex flex-col gap-1">
                    <div className={`flex items-center justify-between gap-3 ${!s.active ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                            <FlavorIcon flavor={s.metadata?.flavor} className="h-4 w-4 shrink-0" />
                            <div
                                className={`truncate text-sm font-medium ${s.active ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                                style={markerTextColor ? { color: markerTextColor } : undefined}
                            >
                                {displaySessionName}
                            </div>
                            {s.active && s.thinking ? (
                                <LoaderIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)] animate-spin-slow" />
                            ) : null}
                            {s.shareCount && s.shareCount > 0 ? (
                                <span
                                    className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-link)]"
                                    title={t('share.badge', { n: s.shareCount })}
                                >
                                    <ShareIcon className="h-3 w-3" />
                                    {s.shareCount}
                                </span>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs">
                            {todoProgress ? (
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <BulbIcon className="h-3 w-3" />
                                    {todoProgress.completed}/{todoProgress.total}
                                </span>
                            ) : null}
                            {s.pendingRequestsCount > 0 ? (
                                <span className="text-[var(--app-badge-warning-text)]">
                                    {t('session.item.pending')} {s.pendingRequestsCount}
                                </span>
                            ) : null}
                            <span className="text-[var(--app-hint)]">
                                {formatRelativeTime(s.updatedAt, t)}
                            </span>
                        </div>
                    </div>
                    {showPath ? (
                        <div className="truncate text-xs text-[var(--app-hint)]">
                            {s.metadata?.path ?? s.id}
                        </div>
                    ) : null}
                </div>
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                canForkSession={forkSupported}
                canSpawnSessionFromConfig={spawnFromConfigSupported}
                sessionActive={s.active}
                sessionId={s.id}
                markerColor={s.markerColor}
                onSelectMarkerColor={(markerColor) => { void setSessionMarkerColor(markerColor) }}
                onRename={() => setRenameOpen(true)}
                onShare={() => setShareOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                onForkSession={handleForkSession}
                onSpawnSessionFromConfig={handleSpawnSessionFromConfig}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <ShareSessionDialog
                isOpen={shareOpen}
                onClose={() => setShareOpen(false)}
                api={api}
                sessionId={s.id}
                sessionTitle={sessionName}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: sessionName })}
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
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onBrowse?: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    machineLabelsById?: Record<string, string>
    selectedSessionId?: string | null
    projectToolCountsByKey?: ProjectToolCountsByKey
    onOpenProjectTools?: (args: { machineId: string; projectPath: string; tab: 'agents' | 'cron' }) => void
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, machineLabelsById = {} } = props
    const attentionTokens = useSessionAttentionTokens()
    const [searchQuery, setSearchQuery] = useState('')
    const [markerColorFilter, setMarkerColorFilter] = useState<SessionMarkerColor | null>(loadSessionColorFilterPreference)
    const [updateWindow, setUpdateWindow] = useState<UpdateWindowKey | null>(null)
    const normalizedQuery = normalizeSearch(searchQuery)
    const isSearching = normalizedQuery.length > 0
    const isFilteringByMarkerColor = markerColorFilter !== null
    const isFilteringByUpdateWindow = updateWindow !== null
    const isFilteringSessions = isSearching || isFilteringByMarkerColor || isFilteringByUpdateWindow

    const listRef = useRef<HTMLDivElement | null>(null)

    // 在会话列表区域（含搜索框）内按上下方向键切换会话；
    // 仅当焦点位于本列表容器内时才生效（事件从容器内元素冒泡而来）
    const handleListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        const root = listRef.current
        if (!root) return
        const items = Array.from(root.querySelectorAll<HTMLElement>('[data-session-id]'))
        if (items.length === 0) return
        const ids = items.map(el => el.dataset.sessionId ?? '')
        // 当前位置：优先取当前聚焦的会话项，其次取选中会话
        let currentIndex = -1
        const active = document.activeElement
        if (active instanceof HTMLElement && active.dataset.sessionId) {
            currentIndex = ids.indexOf(active.dataset.sessionId)
        }
        if (currentIndex === -1 && selectedSessionId) {
            currentIndex = ids.indexOf(selectedSessionId)
        }
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = currentIndex === -1
            ? (event.key === 'ArrowDown' ? 0 : ids.length - 1)
            : Math.max(0, Math.min(ids.length - 1, currentIndex + delta))
        const nextId = ids[nextIndex]
        if (nextId) {
            props.onSelect(nextId)
            event.preventDefault()
        }
    }, [props.onSelect, selectedSessionId])

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const allSessions = useMemo(
        () => props.sessions,
        [props.sessions]
    )
    const markerColorCounts = useMemo(
        () => getMarkerColorCounts(allSessions),
        [allSessions]
    )
    useEffect(() => {
        saveSessionColorFilterPreference(markerColorFilter)
    }, [markerColorFilter])
    // 各时间窗口的会话计数（用于菜单展示）
    const updateWindowCounts = useMemo(() => {
        const counts = {} as Record<UpdateWindowKey, number>
        for (const option of UPDATE_WINDOW_OPTIONS) {
            counts[option.key] = 0
        }
        for (const session of allSessions) {
            for (const option of UPDATE_WINDOW_OPTIONS) {
                if (sessionMatchesManagementUpdateWindow(session, option.key)) {
                    counts[option.key] += 1
                }
            }
        }
        return counts
    }, [allSessions])
    const visibleSessions = useMemo(
        () => isFilteringSessions
            ? allSessions.filter(session =>
                sessionMatchesMarkerColor(session, markerColorFilter)
                && sessionMatchesUpdateWindow(session, updateWindow)
                && sessionMatchesQuery(
                    session,
                    normalizedQuery,
                    resolveMachineLabel(session.metadata?.machineId ?? null)
                )
            )
            : allSessions,
        [allSessions, isFilteringSessions, markerColorFilter, updateWindow, normalizedQuery, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const allGroups = useMemo(
        () => groupSessionsByDirectory(allSessions),
        [allSessions]
    )
    const groups = useMemo(
        () => groupSessionsByDirectory(visibleSessions),
        [visibleSessions]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        if (isSearching) return false
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId)
            : false
        return !group.hasActiveSession && !hasSelectedSession
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    const isSessionGroupExpanded = (group: SessionGroup): boolean => {
        if (isSearching || group.sessions.length <= GROUP_SESSION_PREVIEW_LIMIT) return true
        const key = `sessions::${group.key}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return !override
        return false
    }

    const toggleSessionGroup = (group: SessionGroup) => {
        const key = `sessions::${group.key}`
        const expanded = isSessionGroupExpanded(group)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, expanded)
            return next
        })
    }

    const getVisibleGroupSessions = (group: SessionGroup): SessionSummary[] => {
        return getVisibleSessionPreview(
            group.sessions,
            {
                expanded: isSessionGroupExpanded(group),
                selectedSessionId
            }
        )
    }

    const machineGroups = useMemo(
        () => groupByMachine(groups, resolveMachineLabel),
        [groups, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )

    const isMachineCollapsed = (mg: MachineGroup): boolean => {
        if (isSearching) return false
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return override
        const hasSelected = selectedSessionId
            ? mg.projectGroups.some(pg => pg.sessions.some(s => s.id === selectedSessionId))
            : false
        return !mg.hasActiveSession && !hasSelected
    }

    const toggleMachine = (mg: MachineGroup) => {
        const key = `machine::${mg.machineId ?? UNKNOWN_MACHINE_ID}`
        const current = isMachineCollapsed(mg)
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, !current)
            return next
        })
    }

    // Auto-expand group (and machine) containing selected session
    useEffect(() => {
        if (!selectedSessionId) return
        setCollapseOverrides(prev => {
            const group = allGroups.find(g =>
                g.sessions.some(s => s.id === selectedSessionId)
            )
            if (!group) return prev
            return expandSelectedSessionCollapseOverrides(prev, group)
        })
    }, [selectedSessionId, allGroups])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of allGroups) {
                knownKeys.add(g.key)
                knownKeys.add(`sessions::${g.key}`)
                knownKeys.add(`machine::${g.machineId ?? UNKNOWN_MACHINE_ID}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    return (
        <div ref={listRef} onKeyDown={handleListKeyDown} className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {isFilteringSessions
                            ? t('sessions.search.count', { n: visibleSessions.length, total: allSessions.length })
                            : t('sessions.count', { n: props.sessions.length, m: allGroups.length })}
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            {props.sessions.length > 0 ? (
                <SessionListSearch
                    value={searchQuery}
                    onChange={setSearchQuery}
                    markerColorFilter={markerColorFilter}
                    markerColorCounts={markerColorCounts}
                    totalCount={allSessions.length}
                    onMarkerColorFilterChange={setMarkerColorFilter}
                    updateWindow={updateWindow}
                    updateWindowCounts={updateWindowCounts}
                    onUpdateWindowChange={setUpdateWindow}
                />
            ) : null}

            {props.sessions.length === 0 && (
                <SessionsEmptyState
                    onNewSession={props.onNewSession}
                    onBrowse={props.onBrowse}
                />
            )}

            {props.sessions.length > 0 && isFilteringSessions && visibleSessions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                    {isFilteringByMarkerColor
                        ? t('sessions.filter.noResults')
                        : t('sessions.search.noResults')}
                </div>
            ) : null}

            <div className="flex flex-col gap-3 px-2 pt-1 pb-2">
                {machineGroups.map((mg) => {
                    const machineCollapsed = isMachineCollapsed(mg)
                    return (
                        <div key={mg.machineId ?? UNKNOWN_MACHINE_ID}>
                            {/* Level 1: Machine */}
                            <button
                                type="button"
                                onClick={() => toggleMachine(mg)}
                                className="flex w-full items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] select-none"
                            >
                                <ChevronIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" collapsed={machineCollapsed} />
                                <MachineIcon className="h-4 w-4 text-[var(--app-hint)] shrink-0" />
                                <span className="text-sm font-semibold truncate flex-1">{mg.label}</span>
                                <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">({mg.totalSessions})</span>
                            </button>

                            {/* Level 2: Projects */}
                            <div className="collapsible-panel" data-open={!machineCollapsed || undefined}>
                                <div className="collapsible-inner">
                                <div className="flex flex-col ml-3.5 pl-1 mt-0.5">
                                    {mg.projectGroups.map((group) => {
                                        const isCollapsed = isGroupCollapsed(group)
                                        const visibleGroupSessions = getVisibleGroupSessions(group)
                                        const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
                                        const sessionGroupExpanded = isSessionGroupExpanded(group)
                                        const projectToolsKey = getProjectToolCountsKey(group.machineId, group.directory)
                                        const projectToolCounts = projectToolsKey ? props.projectToolCountsByKey?.[projectToolsKey] : undefined
                                        const canOpenProjectTools = Boolean(group.machineId && props.onOpenProjectTools && group.directory !== 'Other')
                                        return (
                                            <div key={group.key}>
                                                <div
                                                    className="group/project sticky top-0 z-10 flex items-center gap-2 px-1 py-1.5 text-left rounded-lg transition-colors hover:bg-[var(--app-subtle-bg)] cursor-pointer min-w-0 w-full select-none"
                                                    onClick={() => toggleGroup(group.key, isCollapsed)}
                                                    title={group.directory}
                                                >
                                                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                                                    <span className="font-medium text-sm truncate flex-1">
                                                        {group.displayName}
                                                    </span>
                                                    {canOpenProjectTools ? (
                                                        <>
                                                            <ProjectToolCountButton
                                                                label="Agents"
                                                                icon="🤖"
                                                                count={projectToolCounts?.agents ?? 0}
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    props.onOpenProjectTools?.({
                                                                        machineId: group.machineId!,
                                                                        projectPath: group.directory,
                                                                        tab: 'agents',
                                                                    })
                                                                }}
                                                            />
                                                            <ProjectToolCountButton
                                                                label="Cron"
                                                                icon="⏰"
                                                                count={projectToolCounts?.crons ?? 0}
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    props.onOpenProjectTools?.({
                                                                        machineId: group.machineId!,
                                                                        projectPath: group.directory,
                                                                        tab: 'cron',
                                                                    })
                                                                }}
                                                            />
                                                        </>
                                                    ) : null}
                                                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                                                    <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                                                        ({group.sessions.length})
                                                    </span>
                                                </div>

                                                {/* Level 3: Sessions */}
                                                <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                                                    <div className="collapsible-inner">
                                                    <div className="flex flex-col gap-0.5 ml-3 pl-1 pr-1 py-1">
                                                        {visibleGroupSessions.map((s) => (
                                                            <SessionItem
                                                                key={s.id}
                                                                session={s}
                                                                onSelect={props.onSelect}
                                                                showPath={false}
                                                                api={api}
                                                                selected={s.id === selectedSessionId}
                                                                attentionToken={attentionTokens[s.id]}
                                                            />
                                                        ))}
                                                        {!isSearching && group.sessions.length > GROUP_SESSION_PREVIEW_LIMIT && (sessionGroupExpanded || hiddenSessionCount > 0) ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleSessionGroup(group)}
                                                                className={cn(
                                                                    'mx-2 my-1 rounded-md px-2 py-1 text-left text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                                                                    hiddenSessionCount > 0 && 'border border-dashed border-[var(--app-border)]'
                                                                )}
                                                            >
                                                                {sessionGroupExpanded
                                                                    ? t('sessions.group.showLess')
                                                                    : t('sessions.group.showMore', { n: hiddenSessionCount })}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
