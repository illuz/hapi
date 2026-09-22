import {
    compactAutoRetryMessage
} from '@hapi/protocol/autoContinue'
import type { AgentEvent, AgentEventBlock, ChatBlock, NormalizedMessage } from '@/chat/types'

function parseClaudeUsageLimit(text: string): AgentEvent | null {
    const reachedMatch = text.match(/^Claude AI usage limit reached\|(\d+)(?:\|([^|]*))?$/)
    if (reachedMatch) {
        const timestamp = Number.parseInt(reachedMatch[1], 10)
        if (Number.isFinite(timestamp)) {
            return { type: 'limit-reached', endsAt: timestamp, limitType: reachedMatch[2] || '' }
        }
    }

    const warningMatch = text.match(/^Claude AI usage limit warning\|(\d+)\|(\d+)\|([^|]*)$/)
    if (warningMatch) {
        const timestamp = Number.parseInt(warningMatch[1], 10)
        const utilization = Number.parseInt(warningMatch[2], 10) / 100
        const limitType = warningMatch[3] || ''
        if (Number.isFinite(timestamp) && Number.isFinite(utilization)) {
            return { type: 'limit-warning', utilization, endsAt: timestamp, limitType }
        }
    }

    return null
}

export function parseMessageAsEvent(msg: NormalizedMessage): AgentEvent | null {
    if (msg.isSidechain) return null
    if (msg.role !== 'agent') return null

    for (const content of msg.content) {
        if (content.type === 'text') {
            const limitEvent = parseClaudeUsageLimit(content.text)
            if (limitEvent !== null) {
                return limitEvent
            }
        }
    }

    return null
}

export function dedupeAgentEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []
    let prevEventKey: string | null = null
    let prevTitleChangedTo: string | null = null

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            prevEventKey = null
            prevTitleChangedTo = null
            continue
        }

        const event = block.event as { type: string; [key: string]: unknown }
        if (event.type === 'title-changed' && typeof event.title === 'string') {
            const title = event.title.trim()
            const key = `title-changed:${title}`
            if (key === prevEventKey) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = title
            continue
        }

        if (event.type === 'message' && typeof event.message === 'string') {
            const message = event.message.trim()
            const key = `message:${message}`
            if (key === prevEventKey) {
                continue
            }
            if (prevTitleChangedTo && message === prevTitleChangedTo) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = null
            continue
        }

        let key: string
        try {
            key = `event:${JSON.stringify(event)}`
        } catch {
            key = `event:${String(event.type)}`
        }

        if (key === prevEventKey) {
            continue
        }

        result.push(block)
        prevEventKey = key
        prevTitleChangedTo = null
    }

    return result
}

/**
 * Fold consecutive api-error events, keeping only the latest state.
 */
export function foldApiErrorEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            continue
        }

        const event = block.event as { type: string }
        if (event.type !== 'api-error') {
            result.push(block)
            continue
        }

        const prev = result[result.length - 1] as AgentEventBlock | undefined
        if (prev?.kind === 'agent-event' && (prev.event as { type: string }).type === 'api-error') {
            result[result.length - 1] = block
        } else {
            result.push(block)
        }
    }

    return result
}

function getAgentMessage(block: ChatBlock): string | null {
    if (
        block.kind !== 'agent-event'
        || block.event.type !== 'message'
        || typeof block.event.message !== 'string'
    ) {
        return null
    }
    return block.event.message.trim() || null
}

function isAutoRetryFailureMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase()
    return normalized === 'task failed'
        || normalized.includes('codex thread entered systemerror')
        || normalized.startsWith('process exited unexpectedly')
}

function getAutoRetryLabel(block: ChatBlock): string | null {
    const message = getAgentMessage(block)
    if (!message) return null
    return compactAutoRetryMessage(message) ?? (isAutoRetryFailureMessage(message) ? 'AUTO retry failed' : null)
}

function isContinueText(block: ChatBlock): boolean {
    return block.kind === 'user-text' && block.text.trim().toLowerCase() === 'continue'
}

function isAutoRetryContinue(block: ChatBlock): boolean {
    if (!isContinueText(block) || !block.meta || typeof block.meta !== 'object') {
        return false
    }
    return (block.meta as Record<string, unknown>).sentFrom === 'auto-retry'
}

function isAutoRetryBridge(block: ChatBlock): boolean {
    // 本地会话切换到远程时，事件会插在失败和自动 continue 之间；它属于同一轮恢复，
    // 但不需要在紧凑汇总中单独占一行。
    return block.kind === 'agent-event' && block.event.type === 'switch'
}

function foldAutoRetryBlockList(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (let index = 0; index < blocks.length;) {
        const first = blocks[index]
        if (!first || (!getAutoRetryLabel(first) && !isAutoRetryContinue(first))) {
            result.push(first)
            index += 1
            continue
        }

        const run: ChatBlock[] = []
        while (index < blocks.length) {
            const block = blocks[index]
            const isCandidate = block && (getAutoRetryLabel(block) || isContinueText(block))
            const isBridge = block && isAutoRetryBridge(block) && run.length > 0
            if (!block || (!isCandidate && !isBridge)) {
                break
            }
            run.push(block)
            index += 1
        }

        const retryBlocks = run.filter((block): block is AgentEventBlock => getAutoRetryLabel(block) !== null)
        const continueBlocks = run.filter(isAutoRetryContinue)
        const continueTextBlocks = run.filter(isContinueText)

        // 单个错误仍沿用原来的短标识；出现自动 continue 或多个错误时再折叠。
        const shouldFoldRecovery = continueBlocks.length > 0
            || (continueTextBlocks.length > 0 && retryBlocks.length >= 2)
        if (!shouldFoldRecovery && retryBlocks.length <= 1) {
            result.push(...run)
            continue
        }

        let recoverySegments = 0
        let hasFailureInSegment = false
        for (const block of run) {
            if (getAutoRetryLabel(block)) {
                hasFailureInSegment = true
                continue
            }
            if (isContinueText(block) && hasFailureInSegment) {
                recoverySegments += 1
                hasFailureInSegment = false
            }
        }
        if (hasFailureInSegment && continueTextBlocks.length > 0) {
            recoverySegments += 1
        }
        const recoveryCount = continueTextBlocks.length > 0
            ? Math.max(continueTextBlocks.length, recoverySegments)
            : 0
        const details = run.flatMap((block) => {
            const label = getAutoRetryLabel(block)
            if (label) return [label]
            return isContinueText(block) ? ['continue'] : []
        })
        const last = [...run].reverse().find((block) => getAutoRetryLabel(block) || isContinueText(block)) ?? first

        result.push({
            kind: 'agent-event',
            id: `auto-retry-summary:${first.id}`,
            createdAt: first.createdAt,
            invokedAt: last.invokedAt,
            model: retryBlocks[retryBlocks.length - 1]?.model,
            event: {
                type: 'auto-retry-summary',
                recoveryCount,
                retryCount: retryBlocks.length,
                details
            }
        })
    }

    return result
}

/** 把连续的 AUTO 错误与自动 continue 合并成一条可展开的汇总。 */
export function foldAutoRetryRecoveries(blocks: ChatBlock[]): ChatBlock[] {
    const withFoldedChildren = blocks.map((block) => {
        if (block.kind !== 'tool-call' || block.children.length === 0) {
            return block
        }
        return {
            ...block,
            children: foldAutoRetryRecoveries(block.children)
        }
    })

    return foldAutoRetryBlockList(withFoldedChildren)
}
