import { isAutomaticContinuationMeta } from '@hapi/protocol/messages'
import type {
    AgentEventBlock,
    AgentReasoningBlock,
    AgentTextBlock,
    ChatBlock,
    CliOutputBlock,
    CodexReviewBlock,
    ToolCallBlock,
    UserTextBlock,
} from '@/chat/types'
import type { ToolGroupBlock, VisibleChatBlock } from '@/chat/toolGroups'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'

/** 可收进单个 assistant turn 的块。 */
export type WorkGroupChildBlock =
    | AgentTextBlock
    | AgentReasoningBlock
    | CodexReviewBlock
    | CliOutputBlock
    | AgentEventBlock
    | UserTextBlock
    | ToolCallBlock
    | ToolGroupBlock

export type WorkGroupSummary = {
    reasoningCount: number
    reviewCount: number
    eventCount: number
    toolGroupCount: number
    toolCount: number
    errorCount: number
    runningCount: number
    pendingCount: number
    waitingForInputCount: number
}

export type WorkGroupBlock = {
    kind: 'work-group'
    id: string
    /** 由组外相邻消息生成的稳定折叠状态锚点。 */
    stateKey?: string
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
    /** Summary-mode groups fetch their child blocks only after opening. */
    detailsState?: 'summary' | 'loaded' | 'error'
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
    if (block.kind === 'user-text') return isAutomaticContinuationMeta(block.meta)
    if (block.kind === 'agent-reasoning') return block.text.trim().length > 0
    if (block.kind === 'tool-group' || block.kind === 'tool-call') return true
    if (block.kind === 'cli-output') return block.source === 'assistant'
    // Title changes are transcript metadata, not execution work. Keep them
    // as standalone system messages so a long tool group cannot hide them.
    return block.kind === 'agent-event' && block.event.type !== 'title-changed'
}

function isTurnBoundary(block: VisibleChatBlock): boolean {
    return (block.kind === 'user-text' && !isAutomaticContinuationMeta(block.meta))
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

function isWaitingForInputTool(tool: ToolCallBlock): boolean {
    if (tool.tool.state === 'completed' || tool.tool.state === 'error') return false
    return tool.tool.permission?.status === 'pending'
        || isAskUserQuestionToolName(tool.tool.name)
        || isRequestUserInputToolName(tool.tool.name)
}

/** Whether a work-group child still needs an explicit user response. */
export function isWorkGroupWaitingForInput(block: WorkGroupChildBlock): boolean {
    if (block.kind === 'tool-group') return block.tools.some(isWaitingForInputTool)
    if (block.kind !== 'tool-call') return false
    return isWaitingForInputTool(block)
        || block.children.some((child) => child.kind === 'tool-call' && isWaitingForInputTool(child))
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

export function getWorkGroupTiming(blocks: WorkGroupChildBlock[], now: number, completionAt: number | null = null) {
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
    if (
        completionAt !== null
        && Number.isFinite(completionAt)
        && startedAt !== null
        && completionAt >= startedAt
    ) {
        completed.push(completionAt)
    }
    const completedAt = !active && completed.length > 0 ? Math.max(...completed) : null
    const end = active ? now : completedAt
    const rangeDuration = startedAt !== null && end !== null && end >= startedAt
        ? end - startedAt
        : null
    const explicitDuration = explicitDurations.length > 0 ? Math.max(...explicitDurations) : null

    const durationMs = rangeDuration !== null && explicitDuration !== null
        ? Math.max(rangeDuration, explicitDuration)
        : rangeDuration ?? explicitDuration

    return {
        startedAt,
        completedAt,
        durationMs,
        running: counts.runningCount > 0,
        pending: counts.pendingCount > 0,
        runningCount: counts.runningCount,
        pendingCount: counts.pendingCount,
        errorCount: counts.errorCount
    }
}

function summarizeWorkGroup(blocks: WorkGroupChildBlock[]): WorkGroupSummary {
    let reasoningCount = 0
    let reviewCount = 0
    let eventCount = 0
    let toolGroupCount = 0
    let toolCount = 0
    let errorCount = 0
    let runningCount = 0
    let pendingCount = 0
    let waitingForInputCount = 0

    for (const block of blocks) {
        if (block.kind === 'agent-reasoning') {
            reasoningCount += 1
            continue
        }

        if (block.kind === 'cli-output') {
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
            waitingForInputCount += block.tools.filter(isWaitingForInputTool).length
            continue
        }

        if (block.kind !== 'tool-call') continue

        toolCount += 1
        if (block.tool.state === 'error') errorCount += 1
        if (block.tool.state === 'running') runningCount += 1
        if (block.tool.state === 'pending') pendingCount += 1
        if (isWaitingForInputTool(block)) waitingForInputCount += 1
    }

    return {
        reasoningCount,
        reviewCount,
        eventCount,
        toolGroupCount,
        toolCount,
        errorCount,
        runningCount,
        pendingCount,
        waitingForInputCount
    }
}

/**
 * 将连续的 assistant 执行过程合并为一个顶层工作项。
 *
 * assistant 文本和 review 保持在组外，确保最终回答始终可见；思考、工具调用、
 * CLI 输出和事件收进组内，让执行过程可以像 Codex 一样只占一个折叠行。
 */
export function buildVisibleWorkGroups(
    blocks: VisibleChatBlock[],
    options: WorkGroupingOptions = {}
): WorkVisibleChatBlock[] {
    const visibleBlocks: WorkVisibleChatBlock[] = []
    const previousGroups = options.previousGroups ?? []
    const usedGroupIds = new Set<string>()
    let previousAnchorId: string | null = null

    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]!
        if (isTurnBoundary(block)) {
            visibleBlocks.push(block)
            previousAnchorId = block.id
            continue
        }

        // 最终回答不是执行过程的一部分，必须保持在折叠卡片外。
        if (block.kind === 'agent-text' || block.kind === 'codex-review') {
            visibleBlocks.push(block)
            previousAnchorId = block.id
            continue
        }

        if (!isWorkGroupChild(block)) {
            visibleBlocks.push(block)
            previousAnchorId = (block as VisibleChatBlock).id
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

        const nextAnchor = blocks.slice(cursor).find((candidate) => !isWorkGroupChild(candidate)) as VisibleChatBlock | undefined
        const summary = summarizeWorkGroup(children)
        const completionAt = nextAnchor && !isTurnBoundary(nextAnchor) ? nextAnchor.createdAt : null
        const timing = getWorkGroupTiming(children, Date.now(), completionAt)
        const needsOlderHistory = Boolean(options.hasMoreMessages && visibleBlocks.length === 0)
        const id = createWorkGroupId(children, previousGroups, usedGroupIds)
        usedGroupIds.add(id)
        const hasUserAfter = blocks.slice(cursor).some(isTurnBoundary)
        const hasExecutionAfter = blocks.slice(cursor).some(isWorkGroupChild)
        const isLatestWorkGroup = !hasUserAfter && !hasExecutionAfter
        const active = timing.running || timing.pending || Boolean(options.isRunning && isLatestWorkGroup)
        const defaultOpen = active
        const stateKey = nextAnchor
            ? `after:${nextAnchor.id}`
            : previousAnchorId
                ? `after:${previousAnchorId}`
                : `tail:${children.at(-1)!.id}`

        visibleBlocks.push({
            kind: 'work-group',
            id,
            stateKey,
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
        : group.summary.waitingForInputCount > 0
            ? 'pending'
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
