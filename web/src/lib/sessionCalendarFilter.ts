import type { SessionSummary } from '@/types/api'

function toMilliseconds(value: number): number {
    return value < 1_000_000_000_000 ? value * 1000 : value
}

export function sessionDateKey(timestamp: number, timeZone?: string): string | null {
    const date = new Date(toMilliseconds(timestamp))
    if (!Number.isFinite(date.getTime())) return null
    if (!timeZone) {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date)
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
        return `${values.year}-${values.month}-${values.day}`
    } catch {
        return null
    }
}

export function sessionMatchesCalendarDate(session: Pick<SessionSummary, 'updatedAt'>, dateKey: string | null): boolean {
    if (!dateKey) return true
    return sessionDateKey(session.updatedAt) === dateKey
}

