import type { AgentReasoningBlock, ChatBlock, ToolCallBlock } from '@/chat/types'
import type { ToolGroupBlock, VisibleChatBlock } from '@/chat/toolGroups'

/** 可安全收进 Codex 风格「Worked for」行的块。 */
export type WorkGroupChildBlock = AgentReasoningBlock | ToolGroupBlock

export type WorkGroupSummary = {
    reasoningCount: number
    toolGroupCount: number
    toolCount: number
    errorCount: number
    runningCount: number
    pendingCount: number
}

export type WorkGroupBlock = {
    kind: 'work-group'
    id: string
    createdAt: number
    startedAt: number | null
    completedAt: number | null
    durationMs: number | null
    blocks: WorkGroupChildBlock[]
    active: boolean
    defaultOpen: boolean
    historyState: 'complete' | 'needs-older-history'
    needsOlderHistory: boolean
    summary: WorkGroupSummary
}

export type WorkVisibleChatBlock = VisibleChatBlock | WorkGroupBlock

export type WorkGroupingOptions = {
    hasMoreMessages?: boolean
    previousGroups?: WorkGroupBlock[]
    isRunning?: boolean
}

export function isWorkGroupBlock(block: WorkVisibleChatBlock | ChatBlock): block is WorkGroupBlock {
    return block.kind === 'work-group'
}

function isReasoningBlock(block: VisibleChatBlock): block is AgentReasoningBlock {
    return block.kind === 'agent-reasoning' && block.text.trim().length > 0
}

function isWorkGroupChild(block: VisibleChatBlock): block is WorkGroupChildBlock {
    return isReasoningBlock(block) || block.kind === 'tool-group'
}

function getChildId(block: WorkGroupChildBlock): string {
    return block.id
}

function createWorkGroupId(
    blocks: WorkGroupChildBlock[],
    previousGroups: WorkGroupBlock[],
    usedIds: Set<string>
): string {
    const firstId = getChildId(blocks[0]!)
    const lastId = getChildId(blocks[blocks.length - 1]!)
    const currentIds = new Set(blocks.map(getChildId))
    const previous = previousGroups.find((group) => {
        if (usedIds.has(group.id)) return false
        return group.blocks.some((block) => currentIds.has(getChildId(block)))
            || group.blocks[0]?.id === firstId
            || group.blocks.at(-1)?.id === lastId
    })
    if (previous) return previous.id

    const fallback = `work-group:${firstId}`
    return usedIds.has(fallback) ? `work-group:${lastId}` : fallback
}

function getToolTiming(tool: ToolCallBlock): { startedAt: number | null; completedAt: number | null } {
    return {
        startedAt: tool.tool.startedAt ?? tool.tool.createdAt,
        completedAt: tool.tool.completedAt
    }
}

export function getWorkGroupTiming(blocks: WorkGroupChildBlock[], now: number) {
    const started: number[] = []
    const completed: number[] = []
    const explicitDurations: number[] = []
    let runningCount = 0
    let pendingCount = 0
    let errorCount = 0

    for (const block of blocks) {
        if (block.kind === 'agent-reasoning') {
            started.push(block.createdAt)
            if (typeof block.durationMs === 'number' && Number.isFinite(block.durationMs) && block.durationMs >= 0) {
                explicitDurations.push(block.durationMs)
                completed.push(block.createdAt + block.durationMs)
            }
            continue
        }

        for (const tool of block.tools) {
            const timing = getToolTiming(tool)
            if (timing.startedAt !== null && Number.isFinite(timing.startedAt)) started.push(timing.startedAt)
            if (timing.completedAt !== null && Number.isFinite(timing.completedAt)) completed.push(timing.completedAt)
            if (tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && tool.durationMs >= 0) {
                explicitDurations.push(tool.durationMs)
            }
            if (tool.tool.state === 'running') runningCount += 1
            if (tool.tool.state === 'pending') pendingCount += 1
            if (tool.tool.state === 'error') errorCount += 1
        }
    }

    const startedAt = started.length > 0 ? Math.min(...started) : null
    const active = runningCount > 0 || pendingCount > 0
    const completedAt = !active && completed.length > 0 ? Math.max(...completed) : null
    const end = active ? now : completedAt
    const rangeDuration = startedAt !== null && end !== null && end >= startedAt
        ? end - startedAt
        : null
    const explicitDuration = explicitDurations.length > 0 ? Math.max(...explicitDurations) : null

    return {
        startedAt,
        completedAt,
        durationMs: explicitDuration ?? rangeDuration,
        running: runningCount > 0,
        pending: pendingCount > 0,
        runningCount,
        pendingCount,
        errorCount
    }
}

function summarizeWorkGroup(blocks: WorkGroupChildBlock[]): WorkGroupSummary {
    let reasoningCount = 0
    let toolGroupCount = 0
    let toolCount = 0
    let errorCount = 0
    let runningCount = 0
    let pendingCount = 0

    for (const block of blocks) {
        if (block.kind === 'agent-reasoning') {
            reasoningCount += 1
            continue
        }

        toolGroupCount += 1
        toolCount += block.summary.totalTools
        errorCount += block.summary.errorCount
        runningCount += block.summary.runningCount
        pendingCount += block.summary.pendingCount
    }

    return {
        reasoningCount,
        toolGroupCount,
        toolCount,
        errorCount,
        runningCount,
        pendingCount
    }
}

/**
 * 将连续的 reasoning / tool 活动合并为一个顶层工作项。
 *
 * Agent 文本、用户消息、review 卡片、权限提示和 milestone 保持在组外，
 * 确保最终答案和操作仍可见，同时压缩冗长的思考 / 工具流水。
 */
export function buildVisibleWorkGroups(
    blocks: VisibleChatBlock[],
    options: WorkGroupingOptions = {}
): WorkVisibleChatBlock[] {
    const visibleBlocks: WorkVisibleChatBlock[] = []
    const previousGroups = options.previousGroups ?? []
    const usedGroupIds = new Set<string>()

    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]!
        if (!isWorkGroupChild(block)) {
            visibleBlocks.push(block)
            continue
        }

        const children: WorkGroupChildBlock[] = [block]
        let cursor = index + 1
        while (cursor < blocks.length) {
            const candidate = blocks[cursor]
            if (!candidate || !isWorkGroupChild(candidate)) break
            children.push(candidate)
            cursor += 1
        }

        // 单个工具组已经有紧凑折叠；单个 reasoning 仍使用顶层折叠，
        // 这样可以将完整思考流一次性隐藏。
        const shouldCreateGroup = children.length > 1 || children.some((child) => child.kind === 'agent-reasoning')
        if (!shouldCreateGroup) {
            visibleBlocks.push(...children)
            index = cursor - 1
            continue
        }

        const summary = summarizeWorkGroup(children)
        const timing = getWorkGroupTiming(children, Date.now())
        const needsOlderHistory = Boolean(options.hasMoreMessages && visibleBlocks.length === 0)
        const id = createWorkGroupId(children, previousGroups, usedGroupIds)
        usedGroupIds.add(id)
        const hasUserAfter = blocks.slice(cursor).some((candidate) => (
            candidate.kind === 'user-text'
            || (candidate.kind === 'cli-output' && candidate.source === 'user')
        ))
        const isLatestWorkGroup = !hasUserAfter && !blocks.slice(cursor).some(isWorkGroupChild)
        const active = timing.running || timing.pending || Boolean(options.isRunning && isLatestWorkGroup)
        const defaultOpen = active

        visibleBlocks.push({
            kind: 'work-group',
            id,
            createdAt: children[0].createdAt,
            startedAt: timing.startedAt,
            completedAt: timing.completedAt,
            durationMs: timing.durationMs,
            blocks: children,
            active,
            defaultOpen,
            historyState: needsOlderHistory ? 'needs-older-history' : 'complete',
            needsOlderHistory,
            summary
        })
        index = cursor - 1
    }

    return visibleBlocks
}

const WORK_GROUP_MARKER = '__happy_work_group__'

/** 将视觉工作组转换为 assistant-ui 可识别的 tool artifact。 */
export function createWorkGroupArtifact(group: WorkGroupBlock): ToolCallBlock {
    const state: ToolCallBlock['tool']['state'] = group.summary.errorCount > 0
        ? 'error'
        : group.active || group.summary.runningCount > 0
            ? 'running'
            : group.summary.pendingCount > 0
                ? 'pending'
                : 'completed'

    return {
        kind: 'tool-call',
        id: group.id,
        localId: null,
        createdAt: group.createdAt,
        invokedAt: null,
        tool: {
            id: group.id,
            name: WORK_GROUP_MARKER,
            state,
            input: { blocks: group.blocks.length, tools: group.summary.toolCount },
            createdAt: group.createdAt,
            startedAt: group.startedAt,
            completedAt: group.completedAt,
            description: null,
            result: state === 'completed' || state === 'error'
                ? { workGroup: true, blocks: group.blocks.length, tools: group.summary.toolCount }
                : undefined
        },
        children: [],
        meta: { [WORK_GROUP_MARKER]: group }
    }
}

export function getWorkGroupFromArtifact(value: unknown): WorkGroupBlock | null {
    if (!value || typeof value !== 'object') return null
    const candidate = (value as { meta?: unknown }).meta
    if (!candidate || typeof candidate !== 'object') return null
    const group = (candidate as Record<string, unknown>)[WORK_GROUP_MARKER]
    if (!group || typeof group !== 'object') return null
    if ((group as { kind?: unknown }).kind !== 'work-group') return null
    if (!Array.isArray((group as { blocks?: unknown }).blocks)) return null
    return group as WorkGroupBlock
}
