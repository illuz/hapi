import { describe, it, expect } from 'vitest'
import { buildCliArgs } from './run'

describe('buildCliArgs', () => {
    it('adds --permission-mode for valid permission mode', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'bypassPermissions',
        })
        expect(args).toContain('--permission-mode')
        expect(args).toContain('bypassPermissions')
        expect(args).not.toContain('--yolo')
    })

    it('ignores invalid permission mode and falls back to --yolo', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'not-a-real-mode',
        }, true)
        expect(args).not.toContain('--permission-mode')
        expect(args).toContain('--yolo')
    })

    it('ignores invalid permission mode without yolo fallback', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            permissionMode: 'not-a-real-mode',
        })
        expect(args).not.toContain('--permission-mode')
        expect(args).not.toContain('--yolo')
    })

    it('prefers --permission-mode over --yolo when both present', () => {
        const args = buildCliArgs('gemini', {
            directory: '/tmp',
            permissionMode: 'yolo',
        }, true)
        expect(args).toContain('--permission-mode')
        expect(args).toContain('yolo')
        // --yolo flag should NOT be added when --permission-mode is used
        const permIdx = args.indexOf('--permission-mode')
        const yoloIdx = args.indexOf('--yolo')
        expect(yoloIdx).toBe(-1)
    })

    it('adds --yolo when no permissionMode and yolo is true', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
        }, true)
        expect(args).toContain('--yolo')
        expect(args).not.toContain('--permission-mode')
    })

    it('passes --model through for opencode (mid-session model change support)', () => {
        const args = buildCliArgs('opencode', {
            directory: '/tmp',
            model: 'ollama/exaone:4.5-33b-q8',
        })
        expect(args).toContain('--model')
        expect(args).toContain('ollama/exaone:4.5-33b-q8')
    })

    it('passes --service-tier through for codex remote sessions', () => {
        const args = buildCliArgs('codex', {
            directory: '/tmp',
            serviceTier: 'priority',
        })

        expect(args).toContain('--service-tier')
        expect(args).toContain('priority')
    })

    it('defaults new Codex sessions to GPT-5.5 and xhigh reasoning', () => {
        const args = buildCliArgs('codex', {
            directory: '/tmp',
        })

        expect(args).toEqual(expect.arrayContaining([
            '--model',
            'gpt-5.5',
            '--model-reasoning-effort',
            'xhigh'
        ]))
    })

    it('does not inject Codex defaults when resuming', () => {
        const args = buildCliArgs('codex', {
            directory: '/tmp',
            resumeSessionId: 'codex-thread-1',
        })

        expect(args).not.toContain('--model')
        expect(args).not.toContain('--model-reasoning-effort')
    })

    it('passes Claude fork and resume-at flags through for resumed sessions', () => {
        const args = buildCliArgs('claude', {
            directory: '/tmp',
            resumeSessionId: 'claude-session-1',
            forkSession: true,
            resumeSessionAt: 'assistant-uuid-1'
        })

        expect(args).toEqual(expect.arrayContaining([
            '--resume',
            'claude-session-1',
            '--fork-session',
            '--resume-session-at',
            'assistant-uuid-1'
        ]))
    })

    it('validates all known permission modes', () => {
        for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'ask', 'read-only', 'safe-yolo', 'yolo']) {
            const args = buildCliArgs('claude', {
                directory: '/tmp',
                permissionMode: mode,
            })
            expect(args).toContain('--permission-mode')
            expect(args).toContain(mode)
        }
    })
})
