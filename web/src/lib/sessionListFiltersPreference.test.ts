import { afterEach, describe, expect, it } from 'vitest'
import {
    loadSessionListActivityFilter,
    loadSessionListSearchQuery,
    loadSessionListUpdateWindow,
    saveSessionListActivityFilter,
    saveSessionListSearchQuery,
    saveSessionListUpdateWindow,
} from './sessionListFiltersPreference'

afterEach(() => {
    localStorage.clear()
})

describe('sessionListFiltersPreference — searchQuery', () => {
    it('returns empty string by default', () => {
        expect(loadSessionListSearchQuery()).toBe('')
    })

    it('round-trips a non-empty query', () => {
        saveSessionListSearchQuery('deploy')
        expect(loadSessionListSearchQuery()).toBe('deploy')
    })

    it('removes the key when saving empty', () => {
        saveSessionListSearchQuery('deploy')
        saveSessionListSearchQuery('')
        expect(localStorage.getItem('hapi:sessionList:searchQuery')).toBeNull()
    })
})

describe('sessionListFiltersPreference — updateWindow', () => {
    it('returns null by default', () => {
        expect(loadSessionListUpdateWindow()).toBeNull()
    })

    it('round-trips a valid window key', () => {
        saveSessionListUpdateWindow('1h')
        expect(loadSessionListUpdateWindow()).toBe('1h')
    })

    it('removes the key when saving null', () => {
        saveSessionListUpdateWindow('1h')
        saveSessionListUpdateWindow(null)
        expect(localStorage.getItem('hapi:sessionList:updateWindow')).toBeNull()
    })

    it('rejects an invalid stored window key', () => {
        localStorage.setItem('hapi:sessionList:updateWindow', '99d')
        expect(loadSessionListUpdateWindow()).toBeNull()
    })
})

describe('sessionListFiltersPreference — activityFilter', () => {
    it('defaults to true when nothing is stored', () => {
        expect(loadSessionListActivityFilter()).toBe(true)
    })

    it('persists false and reads it back', () => {
        saveSessionListActivityFilter(false)
        expect(loadSessionListActivityFilter()).toBe(false)
    })

    it('removes the key when re-enabling (default)', () => {
        saveSessionListActivityFilter(false)
        saveSessionListActivityFilter(true)
        expect(localStorage.getItem('hapi:sessionList:activityFilter')).toBeNull()
        expect(loadSessionListActivityFilter()).toBe(true)
    })

    it('treats an invalid stored value as enabled', () => {
        localStorage.setItem('hapi:sessionList:activityFilter', 'banana')
        expect(loadSessionListActivityFilter()).toBe(true)
    })
})
