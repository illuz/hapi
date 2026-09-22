import { describe, expect, it } from 'vitest'
import { getEventPresentation, formatMessageTimestamp, formatResetTime } from './presentation'

describe('getEventPresentation — limit-warning', () => {
    it('formats five_hour warning', () => {
        const result = getEventPresentation({
            type: 'limit-warning',
            utilization: 0.9,
            endsAt: 1774278000,
            limitType: 'five_hour',
        })

        expect(result.icon).toBe('⚠️')
        expect(result.text).toMatch(/Usage limit 90% \(5-hour\)/)
        expect(result.text).toMatch(/resets/)
    })

    it('formats seven_day warning', () => {
        const result = getEventPresentation({
            type: 'limit-warning',
            utilization: 0.85,
            endsAt: 1774850400,
            limitType: 'seven_day',
        })

        expect(result.text).toMatch(/Usage limit 85% \(7-day\)/)
    })

    it('omits type label when limitType is empty', () => {
        const result = getEventPresentation({
            type: 'limit-warning',
            utilization: 1,
            endsAt: 1774278000,
            limitType: '',
        })

        expect(result.text).toMatch(/^Usage limit 100% · resets/)
        expect(result.text).not.toMatch(/\(/)
    })

    it('formats unknown limitType with underscore replacement', () => {
        const result = getEventPresentation({
            type: 'limit-warning',
            utilization: 0.5,
            endsAt: 1774278000,
            limitType: 'thirty_day',
        })

        expect(result.text).toMatch(/\(thirty day\)/)
    })
})

describe('getEventPresentation — limit-reached', () => {
    it('shows limitType when present', () => {
        const result = getEventPresentation({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: 'five_hour',
        })

        expect(result.icon).toBe('⏳')
        expect(result.text).toMatch(/^Usage limit reached \(5-hour\) until/)
    })

    it('omits limitType when empty', () => {
        const result = getEventPresentation({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: '',
        })

        expect(result.icon).toBe('⏳')
        expect(result.text).toMatch(/^Usage limit reached until/)
        expect(result.text).not.toMatch(/\(/)
    })
})

describe('getEventPresentation — token-count', () => {
    it('formats Codex token-count as compact context usage', () => {
        const result = getEventPresentation({
            type: 'token-count',
            info: {
                total: {
                    totalTokens: 23745,
                    inputTokens: 23631,
                    cachedInputTokens: 18176,
                    outputTokens: 114,
                    reasoningOutputTokens: 0
                },
                modelContextWindow: 258400
            }
        })

        expect(result.icon).toBe('◷')
        expect(result.text).toBe('Context 23.6k / 258.4k (9%) · out 114 · cached 18.2k')
    })
})

describe('getEventPresentation — AUTO retry errors', () => {
    it('hides the provider error and keeps the retry attempt marker', () => {
        const result = getEventPresentation({
            type: 'message',
            message: 'Task failed: Our servers are currently overloaded; retrying same conversation (2/3)'
        })

        expect(result.icon).toBe('⏳')
        expect(result.text).toBe('AUTO retry 2/3')
    })

    it('uses a compact terminal marker', () => {
        const result = getEventPresentation({
            type: 'message',
            message: 'Task failed: Selected model is at capacity'
        })

        expect(result.icon).toBe('⚠️')
        expect(result.text).toBe('AUTO retry failed')
    })

    it('keeps an in-progress marker when the provider omits retry counts', () => {
        const result = getEventPresentation({
            type: 'message',
            message: 'Task failed: Our servers are currently overloaded; retrying same conversation'
        })

        expect(result.icon).toBe('⏳')
        expect(result.text).toBe('AUTO retrying')
    })

    it('renders a folded recovery summary with expandable details', () => {
        const result = getEventPresentation({
            type: 'auto-retry-summary',
            recoveryCount: 3,
            retryCount: 8,
            details: [
                'AUTO retry 1/3',
                'Task failed: Selected model is at capacity',
                'continue'
            ]
        })

        expect(result).toEqual({
            icon: '🔁',
            text: 'AUTO recovery × 3',
            details: ['AUTO retry 1/3', 'AUTO retry failed', 'continue']
        })
    })
})

describe('formatResetTime', () => {
    it('formats a unix timestamp to a non-empty string', () => {
        const result = formatResetTime(1774278000)
        expect(result).toBeTruthy()
        expect(typeof result).toBe('string')
    })

    it('handles millisecond timestamps', () => {
        const result = formatResetTime(1774278000000)
        expect(result).toBeTruthy()
    })

    it('returns raw value for invalid timestamps', () => {
        const result = formatResetTime(NaN)
        expect(result).toBeTruthy()
    })
})

describe('formatMessageTimestamp', () => {
    it('formats message timestamps to a non-empty string', () => {
        expect(formatMessageTimestamp(1774278000)).toBeTruthy()
        expect(formatMessageTimestamp(new Date())).toBeTruthy()
    })
})
