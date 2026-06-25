import { describe, expect, it } from 'vitest'
import {
    canForkSession,
    canSpawnSessionFromConfig,
    getRollbackTurnsFromOutlineIndex
} from '@/lib/sessionBranching'

describe('sessionBranching', () => {
    it('allows fork for Codex sessions with a persisted agent session id', () => {
        expect(canForkSession({
            metadata: {
                flavor: 'codex',
                agentSessionId: 'thread-1'
            }
        })).toBe(true)

        expect(canForkSession({
            metadata: {
                flavor: 'codex',
                codexSessionId: 'thread-2'
            }
        })).toBe(true)
    })

    it('allows fork for Claude sessions with a persisted agent session id', () => {
        expect(canForkSession({
            metadata: {
                flavor: 'claude',
                agentSessionId: 'thread-1'
            }
        })).toBe(true)

        expect(canForkSession({
            metadata: {
                flavor: 'claude',
                claudeSessionId: 'claude-session-2'
            }
        })).toBe(true)

        expect(canForkSession({
            metadata: {
                flavor: null,
                agentSessionId: 'legacy-claude-session'
            }
        })).toBe(true)
    })

    it('rejects fork for unsupported or missing-agent-session sessions', () => {
        expect(canForkSession({
            metadata: {
                flavor: 'gemini',
                agentSessionId: 'thread-1'
            }
        })).toBe(false)

        expect(canForkSession({
            metadata: {
                flavor: 'codex'
            }
        })).toBe(false)
    })

    it('requires a path to spawn a new session from config', () => {
        expect(canSpawnSessionFromConfig({
            metadata: {
                path: '/tmp/project'
            }
        })).toBe(true)

        expect(canSpawnSessionFromConfig({
            metadata: null
        })).toBe(false)
    })

    it('calculates rollback turns from the selected outline item index', () => {
        expect(getRollbackTurnsFromOutlineIndex(0, 4)).toBe(3)
        expect(getRollbackTurnsFromOutlineIndex(3, 4)).toBe(0)
    })

    it('throws for invalid outline indices', () => {
        expect(() => getRollbackTurnsFromOutlineIndex(-1, 4)).toThrow('index out of range')
        expect(() => getRollbackTurnsFromOutlineIndex(4, 4)).toThrow('index out of range')
    })
})
