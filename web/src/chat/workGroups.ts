import type {
    AgentEventBlock,
    AgentReasoningBlock,
    AgentTextBlock,
    ChatBlock,
    CliOutputBlock,
    CodexReviewBlock,
    ToolCallBlock,
} from '@/chat/types'
import type { ToolGroupBlock, VisibleChatBlock } from '@/chat/toolGroups'

/** 可收进单个 assistant turn 的块。 */
export type WorkGroupChildBlock =
    | AgentTextBlock
    | AgentReasoningBlock
    | CodexReviewBlock
    | CliOutputBlock
    | AgentEventBlock
    | ToolCallBlock
    | ToolGroupBlock

export type WorkGroupSummary = {
    reasoningCount: number
    answerCount: number
    reviewCount: number
    eventCount: number
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

function isWorkGroupChild(block: VisibleChatBlock): block is WorkGroupChildBlock {
    if (block.kind === 'user-text') return false
    if (block.kind === 'cli-output' && block.source === 'user') return false
    return true
}

function isTurnBoundary(block: VisibleChatBlock): boolean {
    return block.kind === 'user-text'
        || (block.kind === 'cli-output' && block.source === 'user')
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

function getBlockDuration(block: WorkGroupChildBlock): number | null {
    if (
        block.kind === 'agent-text'
        || block.kind === 'agent-reasoning'
        || block.kind === 'codex-review'
        || block.kind === 'cli-output'
    ) {
        return typeof block.durationMs === 'number' && Number.isFinite(block.durationMs) && block.durationMs >= 0
            ? block.durationMs
            : null
    }
    return null
}

function addBlockTiming(
    block: WorkGroupChildBlock,
    started: number[],
    completed: number[],
    explicitDurations: number[],
    counts: { runningCount: number; pendingCount: number; errorCount: number }
): void {
    if (block.kind === 'tool-group') {
        for (const tool of block.tools) {
            const timing = getToolTiming(tool)
            if (timing.startedAt !== null && Number.isFinite(timing.startedAt)) started.push(timing.startedAt)
            if (timing.completedAt !== null && Number.isFinite(timing.completedAt)) completed.push(timing.completedAt)
            if (tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && tool.durationMs >= 0) {
                explicitDurations.push(tool.durationMs)
            }
            if (tool.tool.state === 'running') counts.runningCount += 1
            if (tool.tool.state === 'pending') counts.pendingCount += 1
            if (tool.tool.state === 'error') counts.errorCount += 1
        }
        return
    }

    if (block.kind === 'tool-call') {
        const timing = getToolTiming(block)
        if (timing.startedAt !== null && Number.isFinite(timing.startedAt)) started.push(timing.startedAt)
        if (timing.completedAt !== null && Number.isFinite(timing.completedAt)) completed.push(timing.completedAt)
        if (block.durationMs !== undefined && Number.isFinite(block.durationMs) && block.durationMs >= 0) {
            explicitDurations.push(block.durationMs)
        }
        if (block.tool.state === 'running') counts.runningCount += 1
        if (block.tool.state === 'pending') counts.pendingCount += 1
        if (block.tool.state === 'error') counts.errorCount += 1
        return
    }

    started.push(block.createdAt)
    const duration = getBlockDuration(block)
    if (duration !== null) {
        explicitDurations.push(duration)
        completed.push(block.createdAt + duration)
    }
}

export function getWorkGroupTiming(blocks: WorkGroupChildBlock[], now: number) {
    const started: number[] = []
    const completed: number[] = []
    const explicitDurations: number[] = []
    const counts = {
        runningCount: 0,
        pendingCount: 0,
        errorCount: 0
    }

    for (const block of blocks) {
        addBlockTiming(block, started, completed, explicitDurations, counts)
    }

    const startedAt = started.length > 0 ? Math.min(...started) : null
    const active = counts.runningCount > 0 || counts.pendingCount > 0
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
        running: counts.runningCount > 0,
        pending: counts.pendingCount > 0,
        runningCount: counts.runningCount,
        pendingCount: counts.pendingCount,
        errorCount: counts.errorCount
    }
}

function summarizeWorkGroup(blocks: WorkGroupChildBlock[]): WorkGroupSummary {
    let reasoningCount = 0
    let answerCount = 0
    let reviewCount = 0
    let eventCount = 0
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

        if (block.kind === 'agent-text') {
            answerCount += 1
            continue
        }

        if (block.kind === 'cli-output') {
            if (block.source === 'assistant') answerCount += 1
            continue
        }

        if (block.kind === 'codex-review') {
            reviewCount += 1
            continue
        }

        if (block.kind === 'agent-event') {
            eventCount += 1
            continue
        }

        if (block.kind === 'tool-group') {
            toolGroupCount += 1
            toolCount += block.summary.totalTools
            errorCount += block.summary.errorCount
            runningCount += block.summary.runningCount
            pendingCount += block.summary.pendingCount
            continue
        }

        if (block.kind !== 'tool-call') continue

        toolCount += 1
        if (block.tool.state === 'error') errorCount += 1
        if (block.tool.state === 'running') runningCount += 1
        if (block.tool.state === 'pending') pendingCount += 1
    }

    return {
        reasoningCount,
        answerCount,
        reviewCount,
        eventCount,
        toolGroupCount,
        toolCount,
        errorCount,
        runningCount,
        pendingCount
    }
}

/**
 * 将一次 assistant turn 的所有内容合并为一个顶层工作项。
 *
 * 用户消息保持在组外；assistant 文本、思考、工具、review 和事件均收进组内，
 * 让整轮回复可以像 Codex 一样只占一个折叠行。
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
        if (isTurnBoundary(block)) {
            visibleBlocks.push(block)
            continue
        }

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

        const summary = summarizeWorkGroup(children)
        const timing = getWorkGroupTiming(children, Date.now())
        const needsOlderHistory = Boolean(options.hasMoreMessages && visibleBlocks.length === 0)
        const id = createWorkGroupId(children, previousGroups, usedGroupIds)
        usedGroupIds.add(id)
        const hasUserAfter = blocks.slice(cursor).some(isTurnBoundary)
        const isLatestWorkGroup = !hasUserAfter
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
