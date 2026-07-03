import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    cleanupExpiredComposerDrafts,
    clearComposerDraft,
    getComposerDraft,
    saveComposerDraft
} from './composerDraftStorage'

const DAY_MS = 24 * 60 * 60 * 1000

function createStorage(initial: Record<string, string> = {}): Storage {
    const values = new Map(Object.entries(initial))

    return {
        get length() {
            return values.size
        },
        clear: vi.fn(() => values.clear()),
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
        removeItem: vi.fn((key: string) => { values.delete(key) }),
        setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    }
}

function stubStorage(storage: Storage): void {
    vi.stubGlobal('window', { localStorage: storage })
}

describe('composerDraftStorage', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('saves, reads, and clears draft text with updatedAt metadata', () => {
        const storage = createStorage()
        stubStorage(storage)

        saveComposerDraft('session-1', 'hello', 1_000)

        expect(getComposerDraft('session-1')).toBe('hello')
        expect(JSON.parse(storage.getItem('hapi:composer-draft:session-1') ?? '{}')).toEqual({
            v: 1,
            text: 'hello',
            updatedAt: 1_000
        })

        clearComposerDraft('session-1')
        expect(getComposerDraft('session-1')).toBe('')
    })

    it('removes the draft when saving empty text', () => {
        const storage = createStorage({
            'hapi:composer-draft:session-1': JSON.stringify({ v: 1, text: 'hello', updatedAt: 1_000 })
        })
        stubStorage(storage)

        saveComposerDraft('session-1', '')

        expect(storage.getItem('hapi:composer-draft:session-1')).toBeNull()
    })

    it('preserves legacy plain text drafts, including JSON-looking text', () => {
        const storage = createStorage({
            'hapi:composer-draft:plain': 'legacy text',
            'hapi:composer-draft:json': '{"prompt":"legacy json text"}',
            'hapi:composer-draft:json-with-v': '{"v":2,"prompt":"legacy json text"}'
        })
        stubStorage(storage)

        expect(getComposerDraft('plain')).toBe('legacy text')
        expect(getComposerDraft('json')).toBe('{"prompt":"legacy json text"}')
        expect(getComposerDraft('json-with-v')).toBe('{"v":2,"prompt":"legacy json text"}')
    })

    it('cleans drafts older than maxAgeMs and keeps recent drafts', () => {
        const now = 10 * DAY_MS
        const storage = createStorage({
            'hapi:composer-draft:old': JSON.stringify({ v: 1, text: 'old', updatedAt: now - 8 * DAY_MS }),
            'hapi:composer-draft:recent': JSON.stringify({ v: 1, text: 'recent', updatedAt: now - 6 * DAY_MS }),
            'hapi:other': 'keep'
        })
        stubStorage(storage)

        const result = cleanupExpiredComposerDrafts({ now, force: true })

        expect(result).toEqual({ checked: 2, removed: 1, migrated: 0, skipped: false })
        expect(storage.getItem('hapi:composer-draft:old')).toBeNull()
        expect(getComposerDraft('recent')).toBe('recent')
        expect(storage.getItem('hapi:other')).toBe('keep')
    })

    it('migrates legacy drafts instead of deleting unknown-age active text', () => {
        const now = 5_000
        const storage = createStorage({
            'hapi:composer-draft:legacy': 'legacy text'
        })
        stubStorage(storage)

        const result = cleanupExpiredComposerDrafts({ now, force: true })

        expect(result).toEqual({ checked: 1, removed: 0, migrated: 1, skipped: false })
        expect(JSON.parse(storage.getItem('hapi:composer-draft:legacy') ?? '{}')).toEqual({
            v: 1,
            text: 'legacy text',
            updatedAt: now
        })
    })

    it('skips daily cleanup when the last cleanup is recent', () => {
        const now = 2 * DAY_MS
        const storage = createStorage({
            'hapi:composer-drafts:last-cleanup-at': String(now - 60_000),
            'hapi:composer-draft:old': JSON.stringify({ v: 1, text: 'old', updatedAt: 1 })
        })
        stubStorage(storage)

        const result = cleanupExpiredComposerDrafts({ now })

        expect(result).toEqual({ checked: 0, removed: 0, migrated: 0, skipped: true })
        expect(getComposerDraft('old')).toBe('old')
    })

    it('returns a skipped result outside the browser', () => {
        vi.stubGlobal('window', undefined)

        expect(cleanupExpiredComposerDrafts({ force: true })).toEqual({
            checked: 0,
            removed: 0,
            migrated: 0,
            skipped: true
        })
    })
})
