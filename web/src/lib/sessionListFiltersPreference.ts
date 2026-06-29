import {
    SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS,
    type SessionManagementUpdateWindowKey,
} from '@/lib/sessionManagementFilters'

const SEARCH_QUERY_STORAGE_KEY = 'hapi:sessionList:searchQuery'
const UPDATE_WINDOW_STORAGE_KEY = 'hapi:sessionList:updateWindow'
const ACTIVITY_FILTER_STORAGE_KEY = 'hapi:sessionList:activityFilter'

const VALID_UPDATE_WINDOW_KEYS: readonly SessionManagementUpdateWindowKey[] =
    SESSION_MANAGEMENT_UPDATE_WINDOW_OPTIONS.map((option) => option.key)

function isUpdateWindowKey(value: string): value is SessionManagementUpdateWindowKey {
    return (VALID_UPDATE_WINDOW_KEYS as readonly string[]).includes(value)
}

export function loadSessionListSearchQuery(): string {
    if (typeof window === 'undefined') return ''
    try {
        const value = window.localStorage.getItem(SEARCH_QUERY_STORAGE_KEY)
        return typeof value === 'string' ? value : ''
    } catch {
        return ''
    }
}

export function saveSessionListSearchQuery(value: string): void {
    if (typeof window === 'undefined') return
    try {
        if (value) {
            window.localStorage.setItem(SEARCH_QUERY_STORAGE_KEY, value)
        } else {
            window.localStorage.removeItem(SEARCH_QUERY_STORAGE_KEY)
        }
    } catch {
        // Ignore storage failures: filtering still works in-memory.
    }
}

export function loadSessionListUpdateWindow(): SessionManagementUpdateWindowKey | null {
    if (typeof window === 'undefined') return null
    try {
        const value = window.localStorage.getItem(UPDATE_WINDOW_STORAGE_KEY)
        if (value && isUpdateWindowKey(value)) {
            return value
        }
        return null
    } catch {
        return null
    }
}

export function saveSessionListUpdateWindow(value: SessionManagementUpdateWindowKey | null): void {
    if (typeof window === 'undefined') return
    try {
        if (value) {
            window.localStorage.setItem(UPDATE_WINDOW_STORAGE_KEY, value)
        } else {
            window.localStorage.removeItem(UPDATE_WINDOW_STORAGE_KEY)
        }
    } catch {
        // Ignore storage failures: filtering still works in-memory.
    }
}

// Activity filter defaults to true; only the non-default (false) is persisted.
export function loadSessionListActivityFilter(): boolean {
    if (typeof window === 'undefined') return true
    try {
        return window.localStorage.getItem(ACTIVITY_FILTER_STORAGE_KEY) !== 'false'
    } catch {
        return true
    }
}

export function saveSessionListActivityFilter(enabled: boolean): void {
    if (typeof window === 'undefined') return
    try {
        if (enabled) {
            window.localStorage.removeItem(ACTIVITY_FILTER_STORAGE_KEY)
        } else {
            window.localStorage.setItem(ACTIVITY_FILTER_STORAGE_KEY, 'false')
        }
    } catch {
        // Ignore storage failures: filtering still works in-memory.
    }
}
