import { describe, expect, it } from 'vitest'
import { buildSessionResumeCommand } from './sessionResumeCommand'

describe('buildSessionResumeCommand', () => {
    it.each([
        ['codex', 'codex-thread-1', 'codex resume codex-thread-1'],
        ['claude', 'claude-session-1', 'claude --resume claude-session-1'],
        ['gemini', 'gemini-session-1', 'gemini --resume gemini-session-1'],
        ['cursor', 'cursor-chat-1', 'agent --resume cursor-chat-1'],
        ['opencode', 'opencode-session-1', 'opencode --session opencode-session-1'],
        [null, 'legacy-claude-session', 'claude --resume legacy-claude-session'],
    ])('builds the native %s resume command', (flavor, sessionId, expected) => {
        expect(buildSessionResumeCommand(flavor, sessionId)).toBe(expected)
    })

    it('returns null without a usable agent session ID', () => {
        expect(buildSessionResumeCommand('codex', null)).toBeNull()
        expect(buildSessionResumeCommand('codex', 'thread-1; rm -rf /')).toBeNull()
    })

    it('returns null for an unknown agent flavor', () => {
        expect(buildSessionResumeCommand('unknown', 'session-1')).toBeNull()
    })
})
