import { describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@/chat/types'
import { buildVisibleChatBlocks, createToolGroupArtifact, getToolGroupActionKind, getToolGroupFromArtifact, isEligibleForToolGrouping } from './toolGroups'

function tool(id: string, name: string, overrides: Partial<ToolCallBlock['tool']> = {}): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        tool: {
            id,
            name,
            state: 'completed',
            input: {},
            description: null,
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            ...overrides
        },
        children: []
    }
}

describe('tool groups', () => {
    it('groups consecutive ordinary tools while preserving boundaries', () => {
        const read = tool('read-1', 'Read', { input: { file_path: 'a.ts' } })
        const grep = tool('grep-1', 'Grep', { input: { pattern: 'needle' } })
        const task = tool('task-1', 'Task')
        const result = buildVisibleChatBlocks([read, grep, task])

        expect(result).toHaveLength(2)
        expect(result[0]?.kind).toBe('tool-group')
        if (result[0]?.kind === 'tool-group') {
            expect(result[0].tools.map((item) => item.id)).toEqual(['read-1', 'grep-1'])
            expect(result[0].summary.countsByKind.read).toBe(1)
            expect(result[0].summary.countsByKind.search).toBe(1)
        }
        expect(result[1]).toBe(task)
    })

    it('does not group interactive or permission-pending tools', () => {
        const pending = tool('ask-1', 'AskUserQuestion', {
            state: 'pending',
            permission: { id: 'ask-1', status: 'pending' }
        })
        expect(isEligibleForToolGrouping(pending)).toBe(false)
        expect(buildVisibleChatBlocks([pending, tool('read-1', 'Read')])).toHaveLength(2)
    })

    it('keeps a stable artifact marker for assistant-ui conversion', () => {
        const group = buildVisibleChatBlocks([tool('a', 'Read'), tool('b', 'Bash')])[0]
        expect(group?.kind).toBe('tool-group')
        if (group?.kind !== 'tool-group') return
        const artifact = createToolGroupArtifact(group)
        expect(getToolGroupFromArtifact(artifact)?.id).toBe(group.id)
        expect(artifact.tool.result).toEqual({ grouped: true, count: 2 })
        expect(getToolGroupActionKind(group.tools[1]!)).toBe('command')
    })

    it('groups a single Codex exploration call and keeps the preference-driven default', () => {
        const read = tool('codex-read', 'CodexBash', {
            input: {
                command: 'cat package.json',
                command_source: 'agent',
                command_actions: [{ type: 'read', command: 'cat package.json', name: 'package.json', path: '/repo/package.json' }]
            }
        })
        const collapsed = buildVisibleChatBlocks([read])
        expect(collapsed).toHaveLength(1)
        expect(collapsed[0]?.kind).toBe('tool-group')
        if (collapsed[0]?.kind === 'tool-group') {
            expect(collapsed[0].presentationMode).toBe('codex-exploration')
            expect(collapsed[0].defaultOpen).toBe(false)
        }
        const expanded = buildVisibleChatBlocks([read], { codexExplorationCollapsed: false })
        expect(expanded[0]?.kind === 'tool-group' && expanded[0].defaultOpen).toBe(true)
    })

    it('collapses a single non-interactive tool into a compact group', () => {
        const toolCall = tool('single-edit', 'CodexDiff', {
            input: { unified_diff: 'diff --git a/a.ts b/a.ts\n+const value = 1\n' }
        })

        const result = buildVisibleChatBlocks([toolCall])

        expect(result).toHaveLength(1)
        expect(result[0]?.kind).toBe('tool-group')
        if (result[0]?.kind === 'tool-group') {
            expect(result[0].tools).toEqual([toolCall])
            expect(result[0].defaultOpen).toBe(false)
        }
    })

    it('does not group Codex user-shell exploration commands', () => {
        const read = tool('codex-user-read', 'CodexBash', {
            input: {
                command_source: 'userShell',
                command_actions: [{ type: 'read', command: 'cat package.json', name: 'package.json', path: '/repo/package.json' }]
            }
        })
        expect(buildVisibleChatBlocks([read])[0]).toBe(read)
    })

    it('keeps the group id when older pages prepend tools', () => {
        const first = tool('read-1', 'Read')
        const second = tool('read-2', 'Read')
        const initial = buildVisibleChatBlocks([first, second], { hasMoreMessages: true })
        const group = initial[0]
        expect(group?.kind).toBe('tool-group')
        if (group?.kind !== 'tool-group') return

        const older = tool('read-0', 'Read')
        const prepended = buildVisibleChatBlocks([older, first, second], {
            hasMoreMessages: false,
            previousGroups: [group]
        })
        expect(prepended[0]?.kind).toBe('tool-group')
        if (prepended[0]?.kind === 'tool-group') expect(prepended[0].id).toBe(group.id)
    })

    it('keeps the group id when a page extends both ends', () => {
        const first = tool('both-1', 'Read')
        const second = tool('both-2', 'Read')
        const group = buildVisibleChatBlocks([first, second])[0]
        if (group?.kind !== 'tool-group') return
        const extended = buildVisibleChatBlocks([
            tool('both-0', 'Read'), first, second, tool('both-3', 'Read')
        ], { previousGroups: [group] })[0]
        expect(extended?.kind).toBe('tool-group')
        if (extended?.kind === 'tool-group') expect(extended.id).toBe(group.id)
    })

    it('does not duplicate a previous id when a group splits at a boundary', () => {
        const old = buildVisibleChatBlocks([tool('split-1', 'Read'), tool('split-2', 'Read'), tool('split-3', 'Read')])[0]
        if (old?.kind !== 'tool-group') return
        const boundary = tool('split-boundary', 'CodexPermission')
        const next = buildVisibleChatBlocks([
            tool('split-1', 'Read'), tool('split-2', 'Read'), boundary, tool('split-3', 'Read'), tool('split-4', 'Read')
        ], { previousGroups: [old] })
        const groups = next.filter((block): block is Extract<typeof block, { kind: 'tool-group' }> => block.kind === 'tool-group')
        expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length)
    })
})
