import type { ChatBlock, ChatToolCall, ToolCallBlock } from '@/chat/types'
import { isObject } from '@hapi/protocol'
import { isSubagentToolName } from '@/chat/subagentTool'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { getInputStringAny } from '@/lib/toolInputUtils'

export type ToolGroupActionKind = 'read' | 'search' | 'command' | 'mutation' | 'web' | 'other'

export type ToolGroupSummary = {
    totalTools: number
    countsByKind: Record<ToolGroupActionKind, number>
    errorCount: number
    runningCount: number
    pendingCount: number
}

export type ToolGroupBlock = {
    kind: 'tool-group'
    id: string
    createdAt: number
    invokedAt?: number | null
    firstToolId: string
    lastToolId: string
    tools: ToolCallBlock[]
    summary: ToolGroupSummary
    defaultOpen: boolean
    needsOlderHistory: boolean
}

export type VisibleChatBlock = ChatBlock | ToolGroupBlock

const PLAN_TOOL_NAMES = new Set([
    'TodoWrite',
    'update_plan',
    'ExitPlanMode',
    'exit_plan_mode',
    'CodexReasoning'
])

const MILESTONE_TOOL_NAMES = new Set([
    'Task',
    'Agent',
    'CodexAgent',
    'TeamCreate',
    'TeamDelete',
    'SendMessage',
    'AgyTaskLog',
    'Skill',
    'spawn_agent',
    'send_input',
    'send_message',
    'resume_agent',
    'followup_task',
    'wait_agent',
    'close_agent',
    'interrupt_agent',
    'list_agents'
])

function isInteractiveToolBlock(block: ToolCallBlock): boolean {
    return block.tool.name === 'CodexPermission'
        || block.tool.permission?.status === 'pending'
        || isAskUserQuestionToolName(block.tool.name)
        || isRequestUserInputToolName(block.tool.name)
}

export function getToolGroupActionKind(block: ToolCallBlock): ToolGroupActionKind {
    const name = block.tool.name
    if (name === 'Read' || name === 'NotebookRead') return 'read'
    if (name === 'Grep' || name === 'Glob' || name === 'LS') return 'search'
    if (name === 'Bash' || name === 'CodexBash' || name === 'shell_command' || name === 'run_shell_command') return 'command'
    if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit' || name === 'CodexPatch' || name === 'CodexDiff') return 'mutation'
    if (name === 'WebFetch' || name === 'WebSearch') return 'web'
    return 'other'
}

export function isEligibleForToolGrouping(block: ToolCallBlock): boolean {
    if (isSubagentToolName(block.tool.name)) return false
    if (PLAN_TOOL_NAMES.has(block.tool.name) || MILESTONE_TOOL_NAMES.has(block.tool.name)) return false
    if (isInteractiveToolBlock(block)) return false
    if (block.tool.name === 'CodexBash') {
        const source = getInputStringAny(block.tool.input, ['command_source', 'commandSource'])
        if (source?.toLowerCase() === 'usershell') return false
    }
    return true
}

function createSummary(tools: ToolCallBlock[]): ToolGroupSummary {
    const countsByKind: Record<ToolGroupActionKind, number> = {
        read: 0,
        search: 0,
        command: 0,
        mutation: 0,
        web: 0,
        other: 0
    }
    let errorCount = 0
    let runningCount = 0
    let pendingCount = 0
    for (const tool of tools) {
        countsByKind[getToolGroupActionKind(tool)] += 1
        if (tool.tool.state === 'error') errorCount += 1
        if (tool.tool.state === 'running') runningCount += 1
        if (tool.tool.state === 'pending') pendingCount += 1
    }
    return { totalTools: tools.length, countsByKind, errorCount, runningCount, pendingCount }
}

export function buildVisibleChatBlocks(
    blocks: ChatBlock[],
    options: { hasMoreMessages?: boolean; previousGroups?: ToolGroupBlock[] } = {}
): VisibleChatBlock[] {
    const visible: VisibleChatBlock[] = []
    const previousGroups = options.previousGroups ?? []

    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]
        if (block.kind !== 'tool-call' || !isEligibleForToolGrouping(block)) {
            visible.push(block)
            continue
        }

        const tools: ToolCallBlock[] = [block]
        let cursor = index + 1
        while (cursor < blocks.length) {
            const candidate = blocks[cursor]
            if (candidate.kind !== 'tool-call' || !isEligibleForToolGrouping(candidate)) break
            tools.push(candidate)
            cursor += 1
        }

        if (tools.length < 2) {
            visible.push(block)
            continue
        }

        const firstToolId = tools[0]?.id ?? block.id
        const lastToolId = tools[tools.length - 1]?.id ?? firstToolId
        const previous = previousGroups.find((group) => group.firstToolId === firstToolId || group.lastToolId === lastToolId)
        const needsOlderHistory = Boolean(options.hasMoreMessages && visible.length === 0)
        // Keep the group identity anchored to the first visible tool.  The
        // `hasMoreMessages` flag can flip after a tail refresh; using it in the
        // id would make assistant-ui remount the whole group and lose its
        // open/closed state.
        const id = previous?.id ?? `tool-group:${firstToolId}`
        visible.push({
            kind: 'tool-group',
            id,
            createdAt: tools[0]?.createdAt ?? block.createdAt,
            invokedAt: tools[0]?.invokedAt,
            firstToolId,
            lastToolId,
            tools,
            summary: createSummary(tools),
            defaultOpen: false,
            needsOlderHistory
        })
        index = cursor - 1
    }

    return visible
}

const TOOL_GROUP_MARKER = '__happy_tool_group__'

/** Convert a visual group to an assistant-ui-compatible tool artifact. */
export function createToolGroupArtifact(group: ToolGroupBlock): ToolCallBlock {
    const state: ChatToolCall['state'] = group.summary.errorCount > 0
        ? 'error'
        : group.summary.runningCount > 0
            ? 'running'
            : group.summary.pendingCount > 0
                ? 'pending'
                : 'completed'
    return {
        kind: 'tool-call',
        id: group.id,
        localId: null,
        createdAt: group.createdAt,
        invokedAt: group.invokedAt,
        tool: {
            id: group.id,
            name: TOOL_GROUP_MARKER,
            state,
            input: { count: group.summary.totalTools },
            createdAt: group.createdAt,
            startedAt: null,
            completedAt: null,
            description: null
        },
        children: [],
        meta: { [TOOL_GROUP_MARKER]: group }
    }
}

export function getToolGroupFromArtifact(value: unknown): ToolGroupBlock | null {
    if (!isObject(value) || value.kind !== 'tool-call' || !isObject(value.meta)) return null
    const candidate = value.meta[TOOL_GROUP_MARKER]
    if (!isObject(candidate) || candidate.kind !== 'tool-group' || !Array.isArray(candidate.tools)) return null
    return candidate as unknown as ToolGroupBlock
}
