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
        expect(getToolGroupActionKind(group.tools[1]!)).toBe('command')
    })
})

