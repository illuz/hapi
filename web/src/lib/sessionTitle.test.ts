import { describe, expect, it } from 'vitest'
import {
    getDisplaySessionTitle,
    getSessionTitle,
    getSessionTitleEmoji,
    hashSessionId,
    SESSION_TITLE_EMOJIS
} from './sessionTitle'

describe('sessionTitle', () => {
    it('prefers explicit session name over summary and path', () => {
        expect(getSessionTitle({
            id: 'session-1',
            metadata: {
                name: 'Fix auth flow',
                summary: { text: 'summary' },
                path: '/work/hapi'
            }
        })).toBe('Fix auth flow')
    })

    it('falls back to the last path segment for regular session titles', () => {
        expect(getSessionTitle({
            id: 'session-2',
            metadata: {
                path: 'C:\\Users\\hanzheng\\github\\hapi'
            }
        })).toBe('hapi')
    })

    it('can preserve the full path when requested', () => {
        expect(getSessionTitle({
            id: 'session-3',
            metadata: {
                path: '/Users/hanzheng/github/hapi'
            }
        }, { pathMode: 'full' })).toBe('/Users/hanzheng/github/hapi')
    })

    it('exposes exactly 50 stable emoji choices', () => {
        expect(SESSION_TITLE_EMOJIS).toHaveLength(50)
        expect(getSessionTitleEmoji('session-emoji-test')).toBe(SESSION_TITLE_EMOJIS[hashSessionId('session-emoji-test') % 50])
    })

    it('prefixes display titles with a deterministic emoji', () => {
        expect(getDisplaySessionTitle({
            id: 'session-4',
            metadata: {
                name: 'Ship landing page'
            }
        })).toBe(`${getSessionTitleEmoji('session-4')} Ship landing page`)
    })
})
