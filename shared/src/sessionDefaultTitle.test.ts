import { describe, expect, it } from 'vitest'
import { getDefaultSessionTitle } from './sessionDefaultTitle'

describe('getDefaultSessionTitle', () => {
    it('returns the Codex default title', () => {
        expect(getDefaultSessionTitle('codex')).toBe('Codex新建会话')
    })

    it('returns the Claude default title', () => {
        expect(getDefaultSessionTitle('claude')).toBe('Claude新建会话')
    })

    it('returns null for other flavors', () => {
        expect(getDefaultSessionTitle('gemini')).toBeNull()
        expect(getDefaultSessionTitle(null)).toBeNull()
    })
})
