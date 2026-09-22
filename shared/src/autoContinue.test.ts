import { describe, expect, it } from 'bun:test'
import {
    compactAutoRetryMessage,
    compactAutoRetryText,
    isAutoRetryableErrorMessage,
    isTerminalAutoRetryableErrorMessage,
    normalizeAutoContinueSettings,
    parseAutoRetryMessage
} from './autoContinue'

describe('auto retry overload handling', () => {
    it('recognizes capacity and overloaded server failures', () => {
        expect(isAutoRetryableErrorMessage('Task failed: Selected model is at capacity')).toBe(true)
        expect(isAutoRetryableErrorMessage('Task failed: Our servers are currently overloaded')).toBe(true)
        expect(isAutoRetryableErrorMessage('Task failed: Our servers are currently\noverloaded')).toBe(true)
        expect(isAutoRetryableErrorMessage('Task failed: Codex thread entered systemError')).toBe(true)
        expect(isAutoRetryableErrorMessage('Task failed: permission denied')).toBe(false)
    })

    it('waits until same-thread retries are exhausted', () => {
        expect(isTerminalAutoRetryableErrorMessage(
            'Task failed: Selected model is at capacity; retrying same conversation (3/3)'
        )).toBe(false)
        expect(isTerminalAutoRetryableErrorMessage(
            'Task failed: Our servers are currently overloaded'
        )).toBe(true)
    })

    it('compacts retry status while retaining the attempt marker', () => {
        expect(parseAutoRetryMessage(
            'Task failed: Our servers are currently overloaded; retrying same conversation (2/3)'
        )).toEqual({ attempt: 2, maxAttempts: 3, inProgress: true })
        expect(compactAutoRetryMessage(
            'Task failed: Our servers are currently overloaded; retrying same conversation (2/3)'
        )).toBe('AUTO retry 2/3')
        expect(compactAutoRetryMessage('Task failed: Selected model is at capacity')).toBe('AUTO retry failed')
        expect(compactAutoRetryMessage('Task failed: Codex thread entered systemError')).toBe('AUTO retry failed')
        expect(compactAutoRetryMessage('Task failed')).toBe('AUTO retry failed')
        expect(compactAutoRetryText(
            'before\nTask failed: Selected model is at capacity\nafter'
        )).toBe('before\nAUTO retry failed\nafter')
        expect(compactAutoRetryText(
            'Task failed: Our servers are currently\noverloaded; retrying same conversation (1/3)'
        )).toBe('AUTO retry 1/3')
        expect(compactAutoRetryText('Task failed')).toBe('AUTO retry failed')
        expect(compactAutoRetryText('before\r\nafter')).toBe('before\r\nafter')
        expect(compactAutoRetryMessage('Task failed: permission denied')).toBeNull()
    })

    it('defaults overload recovery to disabled', () => {
        expect(normalizeAutoContinueSettings(null).retryOnOverload).toBe(false)
        expect(normalizeAutoContinueSettings({ retryOnOverload: true }).retryOnOverload).toBe(true)
    })
})
