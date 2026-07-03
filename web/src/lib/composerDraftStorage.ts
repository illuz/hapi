const DRAFT_KEY_PREFIX = 'hapi:composer-draft:'
const LAST_CLEANUP_KEY = 'hapi:composer-drafts:last-cleanup-at'
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_AGE_MS = 7 * DAY_MS
const DEFAULT_CLEANUP_INTERVAL_MS = DAY_MS

type StoredComposerDraft = {
    v: 1
    text: string
    updatedAt: number
}

type ParsedComposerDraft =
    | { kind: 'stored'; draft: StoredComposerDraft }
    | { kind: 'legacy'; text: string }

type CleanupComposerDraftsOptions = {
    now?: number
    maxAgeMs?: number
    intervalMs?: number
    force?: boolean
}

export type CleanupComposerDraftsResult = {
    checked: number
    removed: number
    migrated: number
    skipped: boolean
}

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function getDraftKey(sessionId: string): string {
    return `${DRAFT_KEY_PREFIX}${sessionId}`
}

function isFiniteTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseComposerDraft(value: string): ParsedComposerDraft {
    try {
        const parsed = JSON.parse(value) as unknown
        if (
            parsed
            && typeof parsed === 'object'
            && (parsed as { v?: unknown }).v === 1
            && typeof (parsed as { text?: unknown }).text === 'string'
            && isFiniteTimestamp((parsed as { updatedAt?: unknown }).updatedAt)
        ) {
            return {
                kind: 'stored',
                draft: parsed as StoredComposerDraft
            }
        }
    } catch {
        return { kind: 'legacy', text: value }
    }

    return { kind: 'legacy', text: value }
}

function serializeComposerDraft(text: string, now: number): string {
    return JSON.stringify({
        v: 1,
        text,
        updatedAt: now
    } satisfies StoredComposerDraft)
}

export function getComposerDraft(sessionId: string): string {
    const storage = getStorage()
    if (!storage) return ''

    try {
        const raw = storage.getItem(getDraftKey(sessionId))
        if (!raw) return ''

        const parsed = parseComposerDraft(raw)
        if (parsed.kind === 'stored') return parsed.draft.text
        return parsed.text
    } catch {
        return ''
    }
}

export function saveComposerDraft(sessionId: string, text: string, now = Date.now()): void {
    const storage = getStorage()
    if (!storage) return

    try {
        const key = getDraftKey(sessionId)
        if (text.length > 0) {
            storage.setItem(key, serializeComposerDraft(text, now))
        } else {
            storage.removeItem(key)
        }
    } catch {
        // Ignore storage quota / privacy mode errors.
    }
}

export function clearComposerDraft(sessionId: string): void {
    const storage = getStorage()
    if (!storage) return

    try {
        storage.removeItem(getDraftKey(sessionId))
    } catch {
        // Ignore storage errors.
    }
}

export function cleanupExpiredComposerDrafts(options: CleanupComposerDraftsOptions = {}): CleanupComposerDraftsResult {
    const storage = getStorage()
    if (!storage) {
        return { checked: 0, removed: 0, migrated: 0, skipped: true }
    }

    const now = options.now ?? Date.now()
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    const intervalMs = options.intervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS

    try {
        if (!options.force) {
            const lastCleanupRaw = storage.getItem(LAST_CLEANUP_KEY)
            const lastCleanupAt = lastCleanupRaw ? Number(lastCleanupRaw) : Number.NaN
            if (Number.isFinite(lastCleanupAt) && now - lastCleanupAt < intervalMs) {
                return { checked: 0, removed: 0, migrated: 0, skipped: true }
            }
        }

        let checked = 0
        let removed = 0
        let migrated = 0

        for (let index = storage.length - 1; index >= 0; index--) {
            const key = storage.key(index)
            if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue

            checked += 1
            const raw = storage.getItem(key)
            if (!raw) {
                storage.removeItem(key)
                removed += 1
                continue
            }

            const parsed = parseComposerDraft(raw)
            if (parsed.kind === 'stored') {
                if (now - parsed.draft.updatedAt > maxAgeMs) {
                    storage.removeItem(key)
                    removed += 1
                }
                continue
            }

            if (parsed.kind === 'legacy') {
                storage.setItem(key, serializeComposerDraft(parsed.text, now))
                migrated += 1
                continue
            }
        }

        storage.setItem(LAST_CLEANUP_KEY, String(now))
        return { checked, removed, migrated, skipped: false }
    } catch {
        return { checked: 0, removed: 0, migrated: 0, skipped: true }
    }
}
