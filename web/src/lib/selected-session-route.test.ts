import { describe, expect, it } from 'vitest'
import { getSelectedSessionIdFromRoute } from './selected-session-route'

describe('getSelectedSessionIdFromRoute', () => {
    it('keeps real session ids', () => {
        expect(getSelectedSessionIdFromRoute('session-123')).toBe('session-123')
    })

    it('ignores static sessions routes that are not sessions', () => {
        expect(getSelectedSessionIdFromRoute('new')).toBeNull()
        expect(getSelectedSessionIdFromRoute('project-tools')).toBeNull()
    })

    it('ignores empty values', () => {
        expect(getSelectedSessionIdFromRoute(null)).toBeNull()
        expect(getSelectedSessionIdFromRoute(undefined)).toBeNull()
        expect(getSelectedSessionIdFromRoute('   ')).toBeNull()
    })
})
