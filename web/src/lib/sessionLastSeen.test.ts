import { beforeEach, describe, expect, it } from 'vitest'
import { getSessionLastSeenAt, initializeSessionLastSeen, markSessionSeen, sessionIsUnread } from './sessionLastSeen'

describe('sessionLastSeen', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('seeds an initial baseline and detects later updates', () => {
        initializeSessionLastSeen('test', [{ id: 's1', updatedAt: 100 }])
        expect(sessionIsUnread({ id: 's1', updatedAt: 100 })).toBe(false)
        expect(sessionIsUnread({ id: 's1', updatedAt: 101 })).toBe(true)
    })

    it('marks the latest activity as seen without moving backwards', () => {
        markSessionSeen('s1', 200)
        markSessionSeen('s1', 100)
        expect(getSessionLastSeenAt('s1')).toBe(200)
        expect(sessionIsUnread({ id: 's1', updatedAt: 200 })).toBe(false)
    })
})

