import { describe, expect, it } from 'vitest'
import type { AgentEventBlock, AgentReasoningBlock, ToolCallBlock } from '@/chat/types'
import { buildVisibleChatBlocks } from './toolGroups'
import {
    buildVisibleWorkGroups,
    createWorkGroupArtifact,
    getWorkGroupFromArtifact,
    getWorkGroupTiming
} from './workGroups'

function reasoning(id: string, text = 'inspect the repository'): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        text
    }
}

function tool(id: string, name: string): ToolCallBlock {
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
            startedAt: 10,
            completedAt: 30
        },
        children: []
    }
}

function titleChanged(id: string, title: string): AgentEventBlock {
    return {
        kind: 'agent-event',
        id,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        event: { type: 'title-changed', title }
    }
}

describe('work groups', () => {
    it('keeps the final answer visible while folding the execution process', () => {
        const toolGroups = buildVisibleChatBlocks([tool('read-1', 'Read'), tool('grep-1', 'Grep')])
        const result = buildVisibleWorkGroups([
            reasoning('reasoning-1'),
            ...toolGroups,
            {
                kind: 'agent-text',
                id: 'answer-1',
                localId: null,
                createdAt: 40,
                text: 'Done.'
            }
        ])

        expect(result).toHaveLength(2)
        expect(result[0]?.kind).toBe('work-group')
        if (result[0]?.kind === 'work-group') {
            expect(result[0].summary.reasoningCount).toBe(1)
            expect(result[0].summary.toolCount).toBe(2)
            expect(result[0].defaultOpen).toBe(false)
            expect(result[0].stateKey).toBe('after:answer-1')
        }
        expect(result[1]).toMatchObject({ kind: 'agent-text', text: 'Done.' })
    })

    it('folds a lone tool group into the assistant turn', () => {
        const toolGroups = buildVisibleChatBlocks([tool('read-1', 'Read')])
        const result = buildVisibleWorkGroups(toolGroups)

        expect(result).toHaveLength(1)
        expect(result[0]?.kind).toBe('work-group')
        if (result[0]?.kind === 'work-group') {
            expect(result[0].summary.toolCount).toBe(1)
        }
    })

    it('starts a new folded turn at each user message', () => {
        const result = buildVisibleWorkGroups([
            {
                kind: 'user-text',
                id: 'user-1',
                localId: null,
                createdAt: 1,
                text: 'First'
            },
            reasoning('reasoning-1'),
            {
                kind: 'agent-text',
                id: 'answer-1',
                localId: null,
                createdAt: 20,
                text: 'Done.'
            },
            {
                kind: 'user-text',
                id: 'user-2',
                localId: null,
                createdAt: 30,
                text: 'Second'
            },
            reasoning('reasoning-2')
        ])

        expect(result.map((block) => block.kind)).toEqual(['user-text', 'work-group', 'agent-text', 'user-text', 'work-group'])
    })

    it('opens the latest group while the turn is running', () => {
        const result = buildVisibleWorkGroups([reasoning('reasoning-1')], { isRunning: true })
        expect(result[0]?.kind).toBe('work-group')
        if (result[0]?.kind === 'work-group') {
            expect(result[0].defaultOpen).toBe(true)
            expect(result[0].active).toBe(true)
            expect(createWorkGroupArtifact(result[0]).tool.state).toBe('running')
        }
    })

    it('does not reopen an older group when a new user turn is running', () => {
        const result = buildVisibleWorkGroups([
            reasoning('reasoning-1'),
            {
                kind: 'agent-text',
                id: 'answer-1',
                localId: null,
                createdAt: 20,
                text: 'Done.'
            },
            {
                kind: 'user-text',
                id: 'user-2',
                localId: null,
                createdAt: 30,
                text: 'Continue'
            }
        ], { isRunning: true })

        expect(result[0]?.kind).toBe('work-group')
        if (result[0]?.kind === 'work-group') expect(result[0].active).toBe(false)
    })

    it('keeps ids stable when an older page prepends work', () => {
        const initial = buildVisibleWorkGroups([reasoning('reasoning-1'), reasoning('reasoning-2')])
        const group = initial[0]
        expect(group?.kind).toBe('work-group')
        if (group?.kind !== 'work-group') return

        const prepended = buildVisibleWorkGroups([reasoning('reasoning-0'), reasoning('reasoning-1'), reasoning('reasoning-2')], {
            previousGroups: [group]
        })
        expect(prepended[0]?.kind).toBe('work-group')
        if (prepended[0]?.kind === 'work-group') {
            expect(prepended[0].id).toBe(group.id)
            expect(prepended[0].stateKey).toBe(group.stateKey)
        }
    })

    it('creates an assistant-ui artifact that round-trips', () => {
        const result = buildVisibleWorkGroups([reasoning('reasoning-1')])
        const group = result[0]
        expect(group?.kind).toBe('work-group')
        if (group?.kind !== 'work-group') return

        const artifact = createWorkGroupArtifact(group)
        expect(getWorkGroupFromArtifact(artifact)?.id).toBe(group.id)
        expect(getWorkGroupFromArtifact(artifact)?.blocks.map((block) => block.id)).toEqual(['reasoning-1'])
        expect(artifact.tool.result).toEqual({ workGroup: true, blocks: 1, tools: 0 })
    })

    it('keeps assistant CLI output and raw tool calls inside the execution group', () => {
        const result = buildVisibleWorkGroups([
            {
                kind: 'cli-output',
                id: 'cli-1',
                localId: null,
                createdAt: 1,
                text: '<local-command-stdout>done</local-command-stdout>',
                source: 'assistant'
            },
            tool('raw-1', 'Task'),
            {
                kind: 'agent-text',
                id: 'answer-1',
                localId: null,
                createdAt: 40,
                text: 'Finished.'
            }
        ])

        expect(result.map((block) => block.kind)).toEqual(['work-group', 'agent-text'])
        if (result[0]?.kind === 'work-group') {
            expect(result[0].blocks.map((block) => block.kind)).toEqual(['cli-output', 'tool-call'])
        }
    })

    it('keeps title changes outside folded execution groups', () => {
        const result = buildVisibleWorkGroups([
            reasoning('reasoning-1'),
            titleChanged('title-2', 'Updated title'),
            tool('tool-3', 'CodexBash')
        ])

        expect(result.map((block) => block.kind)).toEqual(['work-group', 'agent-event', 'work-group'])
        expect(result[1]).toMatchObject({
            kind: 'agent-event',
            event: { type: 'title-changed', title: 'Updated title' }
        })
    })

    it('uses active tool state for timing', () => {
        const [toolGroup] = buildVisibleChatBlocks([tool('read-1', 'Read')])
        if (toolGroup?.kind !== 'tool-group') return
        const timing = getWorkGroupTiming([toolGroup], 100)
        expect(timing.startedAt).toBe(10)
        expect(timing.completedAt).toBe(30)
        expect(timing.durationMs).toBe(20)
        expect(timing.running).toBe(false)
    })
})
