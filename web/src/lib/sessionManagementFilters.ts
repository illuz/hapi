import type { SessionMarkerColor, SessionSummary } from '@/types/api'
import { getSessionTitle } from '@/lib/sessionTitle'

export const SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS = [
    { key: '10m', minutes: 10, direction: 'within' },
    { key: '30m', minutes: 30, direction: 'within' },
    { key: '1h', minutes: 60, direction: 'within' },
    { key: '6h', minutes: 360, direction: 'within' },
    { key: '12h', minutes: 720, direction: 'within' },
    { key: 'last1d', minutes: 1440, direction: 'within' },
    { key: 'last3d', minutes: 4320, direction: 'within' },
    { key: '1d', minutes: 1440, direction: 'olderThan' },
    { key: '3d', minutes: 4320, direction: 'olderThan' },
    { key: '10d', minutes: 14400, direction: 'olderThan' },
] as const

export type SessionManagementUpdateWindowKey = (typeof SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS)[number]['key']
type SessionManagementUpdateWindowOption = (typeof SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS)[number]

function matchesUpdateWindowAge(ageMs: number, option: SessionManagementUpdateWindowOption): boolean {
    const thresholdMs = option.minutes * 60_000
    return option.direction === 'olderThan'
        ? ageMs > thresholdMs
        : ageMs <= thresholdMs
}

export function normalizeSessionManagementSearch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

export function sessionMatchesManagementQuery(
    session: SessionSummary,
    query: string,
    machineLabel: string
): boolean {
    if (!query) return true
    const searchable = [
        getSessionTitle(session),
        session.id,
        session.metadata?.path,
        session.metadata?.worktree?.basePath,
        session.metadata?.name,
        session.metadata?.summary?.text,
        session.metadata?.flavor,
        machineLabel,
    ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n')
        .toLowerCase()
    return searchable.includes(query)
}

export function sessionMatchesManagementMarkerColor(
    session: SessionSummary,
    markerColor: SessionMarkerColor | null
): boolean {
    if (!markerColor) return true
    return session.markerColor === markerColor
}

export function sessionMatchesManagementUpdateWindow(
    session: SessionSummary,
    window: SessionManagementUpdateWindowKey | null
): boolean {
    if (!window) return true
    const option = SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS.find((item) => item.key === window)
    if (!option) return true
    return matchesUpdateWindowAge(Date.now() - session.updatedAt, option)
}
