import { describe, expect, it } from 'vitest'
import {
    findCodexCustomPromptExpansion,
    findUnsupportedCodexBuiltinSlashCommand,
    getBuiltinSlashCommands,
    mergeSlashCommands
} from './codexSlashCommands'

describe('getBuiltinSlashCommands', () => {
    it('exposes HAPI-supported codex built-ins in remote web mode', () => {
        expect(getBuiltinSlashCommands('codex').map((command) => command.name)).toEqual(expect.arrayContaining([
            'clear',
            'compact',
            'fast',
            'goal',
            'plan',
            'status',
            'execute',
            'effort',
            'permission',
        ]))
    })
})

describe('mergeSlashCommands', () => {
    it('lets non-reserved custom commands override same-name built-ins', () => {
        const commands = mergeSlashCommands([
            { name: 'review', source: 'builtin' },
            { name: 'compact', source: 'builtin' },
            { name: 'review', source: 'project', content: 'project review prompt' }
        ])

        expect(commands).toEqual([
            { name: 'compact', source: 'builtin' },
            { name: 'review', source: 'project', content: 'project review prompt' }
        ])
    })

    it('keeps reserved /clear, /compact, and /goal mapped to built-ins', () => {
        const commands = mergeSlashCommands([
            { name: 'clear', source: 'builtin' },
            { name: 'compact', source: 'builtin' },
            { name: 'goal', source: 'builtin' },
            { name: 'clear', source: 'project', content: 'project clear prompt' },
            { name: 'compact', source: 'project', content: 'project compact prompt' },
            { name: 'goal', source: 'project', content: 'project goal prompt' }
        ])

        expect(commands).toEqual([
            { name: 'clear', source: 'builtin' },
            { name: 'compact', source: 'builtin' },
            { name: 'goal', source: 'builtin' }
        ])
    })

    it('keeps API-provided built-ins while de-duplicating by name', () => {
        const commands = mergeSlashCommands([
            { name: 'clear', source: 'builtin' },
            { name: 'status', source: 'builtin' },
            { name: 'help', source: 'builtin' },
            { name: 'status', source: 'builtin', description: 'Captured status' },
            { name: 'project-only', source: 'project', content: 'Project prompt' }
        ])

        expect(commands).toEqual([
            { name: 'clear', source: 'builtin' },
            { name: 'help', source: 'builtin' },
            { name: 'status', source: 'builtin', description: 'Captured status' },
            { name: 'project-only', source: 'project', content: 'Project prompt' }
        ])
    })

})

describe('findCodexCustomPromptExpansion', () => {
    it('expands exact custom codex prompt commands', () => {
        expect(findCodexCustomPromptExpansion('  /review  ', [
            { name: 'review', source: 'builtin' },
            { name: 'review', source: 'project', content: 'custom review prompt' }
        ])).toBe('custom review prompt')
    })

    it('keeps reserved Codex control commands from expanding custom prompts', () => {
        expect(findCodexCustomPromptExpansion('  /clear  ', [
            { name: 'clear', source: 'builtin' },
            { name: 'clear', source: 'project', content: 'custom clear prompt' }
        ])).toBeNull()
        expect(findCodexCustomPromptExpansion('/goal', [
            { name: 'goal', source: 'builtin' },
            { name: 'goal', source: 'project', content: 'custom goal prompt' }
        ])).toBeNull()
    })

    it('ignores built-ins and commands with arguments', () => {
        const commands = [
            { name: 'compact', source: 'project', content: 'custom compact prompt' }
        ] as const

        expect(findCodexCustomPromptExpansion('/compact now', commands)).toBeNull()
        expect(findCodexCustomPromptExpansion('/clear', [
            { name: 'clear', source: 'builtin' }
        ])).toBeNull()
    })
})

describe('findUnsupportedCodexBuiltinSlashCommand', () => {
    it('detects unsupported codex built-ins', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('  /diff ', [])).toBe('diff')
    })

    it('ignores regular messages and unknown commands', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('show me status', [])).toBeNull()
        expect(findUnsupportedCodexBuiltinSlashCommand('/custom-status', [])).toBeNull()
    })

    it('does not block custom commands that override the same name', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('/status', [
            { name: 'status', source: 'project', content: 'project status prompt' }
        ])).toBeNull()
    })
})
