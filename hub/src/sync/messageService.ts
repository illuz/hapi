import { asString, isObject } from '@hapi/protocol'
import type {
    AttachmentMetadata,
    DecryptedMessage,
    TimelineDetailsResponse,
    TimelineSummaryItem,
    TimelineSummaryResponse,
    TimelineWorkSummary
} from '@hapi/protocol/types'
import type { QueuedStateResponse } from '@hapi/protocol/schemas'
import { isAutomaticContinuationMeta, isClaudeChatVisibleMessage, unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { Server } from 'socket.io'
import { randomUUID } from 'node:crypto'
import type { Store, CancelQueuedMessageResult } from '../store'
import { EventPublisher } from './eventPublisher'

type MessagePosition = { at: number; seq: number }

const TIMELINE_DEFAULT_LIMIT = 500
const TIMELINE_MAX_LIMIT = 1000
const TIMELINE_RAW_SCAN_LIMIT = 5_000
const TIMELINE_DETAIL_LIMIT = 10_000
const TIMELINE_CACHE_SESSIONS = 16

type TimelineCacheEntry = {
    epoch: number
    maxSeq: number
    items: TimelineSummaryItem[]
}

export type IncrementalMessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        direction: 'latest' | 'before' | 'after'
        limit: number
        epoch: number
        reset: boolean
        nextBeforeSeq: number | null
        nextBeforeAt: number | null
        nextAfterSeq: number | null
        nextAfterAt: number | null
        snapshotHeadSeq: number | null
        snapshotHeadAt: number | null
        hasMore: boolean
    }
}

export type IncrementalMessagesOptions = {
    limit: number
    before?: MessagePosition | null
    after?: MessagePosition | null
    until?: MessagePosition | null
    epoch?: number | null
}

type LegacyMessagesOptions = { limit: number; beforeSeq: number | null }

type LegacyMessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

function comparePosition(a: MessagePosition, b: MessagePosition): number {
    return a.at !== b.at ? a.at - b.at : a.seq - b.seq
}

function toDecryptedMessage(message: ReturnType<Store['messages']['getMessages']>[number]): DecryptedMessage {
    return {
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        content: message.content,
        createdAt: message.createdAt,
        invokedAt: message.invokedAt
    }
}

export type MessageSentFrom = 'telegram-bot' | 'webapp' | 'auto-continue' | 'auto-retry' | 'project-agent' | 'cron' | 'shared-guest'
type MessageMetaPatch = {
    appendSystemPrompt?: string | null
    customSystemPrompt?: string | null
    fallbackModel?: string | null
    allowedTools?: string[] | null
    disallowedTools?: string[] | null
    shareId?: string | null
    shareLabel?: string | null
}

export type ConversationOutlineEntry = {
    messageId: string
    text: string
    createdAt: number
    seq: number
}

function extractUserText(content: unknown): string {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (record?.role !== 'user') return ''

    const value = record.content
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
        return value
            .filter((item): item is { type: string; text: string } => (
                Boolean(item)
                && typeof item === 'object'
                && (item as Record<string, unknown>).type === 'text'
                && typeof (item as Record<string, unknown>).text === 'string'
            ))
            .map((item) => item.text)
            .join('\n\n')
    }
    if (value && typeof value === 'object') {
        const text = (value as Record<string, unknown>).text
        if (typeof text === 'string') return text
    }
    return ''
}

type TimelineSignals = {
    ignored: boolean
    hasWork: boolean
    hasEvent: boolean
    hasText: boolean
    text: string
    summary: TimelineWorkSummary
    toolCallIds: string[]
    toolResultIds: string[]
    titleChange?: TimelineTitleChange
}

type TimelineTitleChange = {
    title: string
    callId: string | null
}

function emptyTimelineSummary(): TimelineWorkSummary {
    return {
        reasoningCount: 0,
        reviewCount: 0,
        eventCount: 0,
        toolGroupCount: 0,
        toolCount: 0,
        errorCount: 0,
        runningCount: 0,
        pendingCount: 0
    }
}

function appendText(target: string[], value: unknown): void {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (text.length > 0) target.push(text)
}

function hasNonBlankField(value: Record<string, unknown>, ...keys: string[]): boolean {
    return keys.some((key) => {
        const candidate = value[key]
        return typeof candidate === 'string' && candidate.trim().length > 0
    })
}

function hasValidCodexTokenUsage(value: unknown): boolean {
    if (!isObject(value)) return false
    const usage = isObject(value.last)
        ? value.last
        : isObject(value.total)
            ? value.total
            : value
    const input = usage.inputTokens ?? usage.input_tokens
    const output = usage.outputTokens ?? usage.output_tokens
    return typeof input === 'number' && Number.isFinite(input)
        && typeof output === 'number' && Number.isFinite(output)
}

function hasValidCodexPlan(value: Record<string, unknown>): boolean {
    const plan = value.plan ?? value.update ?? value.items ?? value.steps
    if (Array.isArray(plan)) return plan.length > 0
    if (!isObject(plan)) return false
    return ['plan', 'items', 'steps'].some((key) => Array.isArray(plan[key]) && plan[key].length > 0)
}

function emptyTimelineSignals(overrides: Partial<TimelineSignals> = {}): TimelineSignals {
    return {
        ignored: false,
        hasWork: false,
        hasEvent: false,
        hasText: false,
        text: '',
        summary: emptyTimelineSummary(),
        toolCallIds: [],
        toolResultIds: [],
        ...overrides
    }
}

function extractTaskNotificationSummary(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const match = value.match(/<task-notification\b[^>]*>[\s\S]*?<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/task-notification>/i)
    const summary = match?.[1]?.replace(/\s+/g, ' ').trim()
    return summary || null
}

const TITLE_CHANGE_TOOL_NAMES = new Set([
    'change_title',
    'hapi_change_title',
    'hapi__change_title',
    'mcp__hapi__change_title'
])

function isTitleChangeToolName(value: unknown): boolean {
    return typeof value === 'string' && TITLE_CHANGE_TOOL_NAMES.has(value.trim().toLowerCase())
}

function extractTitleChangeTitle(value: unknown, depth = 0): string | null {
    if (depth > 3 || value === null || value === undefined) return null
    if (typeof value === 'string') {
        try {
            return extractTitleChangeTitle(JSON.parse(value), depth + 1)
        } catch {
            return null
        }
    }
    if (!isObject(value)) return null

    const title = asString(value.title)?.trim()
    if (title) return title

    for (const key of ['input', 'arguments', 'parameters']) {
        const nested = extractTitleChangeTitle(value[key], depth + 1)
        if (nested) return nested
    }
    return null
}

function findTitleChangeInvocation(value: unknown, depth = 0): TimelineTitleChange | null {
    if (depth > 8 || value === null || value === undefined) return null
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findTitleChangeInvocation(item, depth + 1)
            if (found) return found
        }
        return null
    }
    if (!isObject(value)) return null

    const name = asString(value.name) ?? asString(value.tool)
    if (isTitleChangeToolName(name)) {
        const title = extractTitleChangeTitle(value.input ?? value.arguments ?? value.invocation)
        if (title) {
            return {
                title,
                callId: asString(value.callId) ?? asString(value.call_id) ?? asString(value.id)
            }
        }
    }

    for (const key of ['content', 'data', 'message', 'payload', 'invocation', 'item']) {
        const found = findTitleChangeInvocation(value[key], depth + 1)
        if (found) return found
    }
    return null
}

function formatTitleChangeText(title: string): string {
    return `Title changed to ${JSON.stringify(title)}`
}

function isHiddenOrNonRenderableAgentRecord(content: unknown): boolean {
    if (!isObject(content)) return false

    if (content.type === 'output' && isObject(content.data)) {
        const data = content.data
        if (data.isMeta === true || data.isCompactSummary === true) return true
        const type = asString(data.type)
        if (type && !isClaudeChatVisibleMessage({ type, subtype: data.subtype })) return true
    }

    if (content.type === 'codex' && isObject(content.data)) {
        const data = content.data
        const type = asString(data.type)
        if (type === 'token_count') return true
        if (type === 'message' && !hasNonBlankField(data, 'message')) return true
        if (type === 'reasoning' && !hasNonBlankField(data, 'message')) return true
        if (type === 'tool-call' && !hasNonBlankField(data, 'callId')) return true
        if (type === 'tool-call-result' && !hasNonBlankField(data, 'callId', 'tool_use_id')) return true
        if (type === 'plan_update' && !hasValidCodexPlan(data)) return true
        if (type === 'token_count' && !hasValidCodexTokenUsage(data.info)) return true
    }

    if (content.type === 'event' && isObject(content.data) && content.data.type === 'ready') {
        return true
    }
    return false
}

function scanTimelineValue(
    value: unknown,
    depth: number,
    textParts: string[],
    summary: TimelineWorkSummary,
    toolCallIds: Set<string>,
    toolResultIds: Set<string>
): {
    hasWork: boolean
    hasEvent: boolean
} {
    if (depth > 8 || value === null || value === undefined) {
        return { hasWork: false, hasEvent: false }
    }
    if (typeof value === 'string') {
        appendText(textParts, value)
        return { hasWork: false, hasEvent: false }
    }
    if (Array.isArray(value)) {
        let hasWork = false
        let hasEvent = false
        for (const item of value) {
            const result = scanTimelineValue(item, depth + 1, textParts, summary, toolCallIds, toolResultIds)
            hasWork = hasWork || result.hasWork
            hasEvent = hasEvent || result.hasEvent
        }
        return { hasWork, hasEvent }
    }
    if (!isObject(value)) return { hasWork: false, hasEvent: false }

    const type = asString(value.type)
    if (
        (type === 'tool_use' && hasNonBlankField(value, 'id'))
        || (type === 'tool-call' && hasNonBlankField(value, 'callId'))
    ) {
        // Codex tool-call records have two identifiers: `id` identifies the
        // envelope event, while `callId` is the invocation identifier shared
        // with the subsequent tool-call-result.  Match the latter first;
        // otherwise every completed call looks permanently running because
        // the envelope ids never appear on result records.
        const id = type === 'tool-call'
            ? asString(value.callId)
            : asString(value.id)
        if (id) toolCallIds.add(id)
        summary.toolCount += 1
        if (summary.toolGroupCount === 0) summary.toolGroupCount = 1
        if (value.is_error === true || value.isError === true) summary.errorCount += 1
        return { hasWork: true, hasEvent: false }
    }
    if (
        (type === 'tool_use_result' && hasNonBlankField(value, 'tool_use_id', 'toolUseId'))
        || (type === 'tool-call-result' && hasNonBlankField(value, 'callId', 'tool_use_id'))
        || (type === 'tool_result' && hasNonBlankField(value, 'tool_use_id', 'toolUseId'))
        || (type === 'tool-result' && hasNonBlankField(value, 'tool_use_id', 'toolUseId'))
    ) {
        const id = asString(value.tool_use_id) ?? asString(value.toolUseId) ?? asString(value.callId)
        if (id) toolResultIds.add(id)
        if (value.is_error === true || value.isError === true) summary.errorCount += 1
        return { hasWork: true, hasEvent: false }
    }
    if (
        (type === 'thinking' && hasNonBlankField(value, 'thinking', 'text'))
        || (type === 'reasoning' && hasNonBlankField(value, 'message', 'text'))
        || (type === 'plan_update' && hasValidCodexPlan(value))
    ) {
        if (type === 'plan_update') {
            summary.toolCount += 1
            summary.toolGroupCount = Math.max(1, summary.toolGroupCount)
        } else {
            summary.reasoningCount += 1
        }
        return { hasWork: true, hasEvent: false }
    }
    if (type === 'codex-review' || type === 'review') {
        summary.reviewCount += 1
        return { hasWork: true, hasEvent: false }
    }
    if (type === 'event' || type === 'system') {
        summary.eventCount += 1
        return { hasWork: true, hasEvent: true }
    }
    if (type === 'token_count' || type === 'token-count') {
        return { hasWork: false, hasEvent: false }
    }

    appendText(textParts, value.text)
    appendText(textParts, value.message)
    appendText(textParts, value.summary)

    let hasWork = false
    let hasEvent = false
    for (const [key, child] of Object.entries(value)) {
        if (key === 'input' || key === 'output' || key === 'content' || key === 'data' || key === 'message' || key === 'payload') {
            const result = scanTimelineValue(child, depth + 1, textParts, summary, toolCallIds, toolResultIds)
            hasWork = hasWork || result.hasWork
            hasEvent = hasEvent || result.hasEvent
        }
    }
    return { hasWork, hasEvent }
}

function classifyTimelineMessage(content: unknown): TimelineSignals {
    const summary = emptyTimelineSummary()
    const textParts: string[] = []
    const toolCallIds = new Set<string>()
    const toolResultIds = new Set<string>()
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (record?.role === 'user' && isAutomaticContinuationMeta(record.meta)) {
        summary.eventCount = 1
        return emptyTimelineSignals({ hasWork: true, hasEvent: true, summary })
    }
    if (record?.role === 'agent' && isObject(record.content) && record.content.type === 'output' && isObject(record.content.data)) {
        const data = record.content.data
        if (data.type === 'user' && isObject(data.message)) {
            const taskSummary = extractTaskNotificationSummary(data.message.content)
            if (taskSummary) {
                summary.eventCount = 1
                return emptyTimelineSignals({ hasWork: true, hasEvent: true, summary })
            }
            if (typeof data.message.content === 'string') {
                return emptyTimelineSignals({ ignored: true })
            }
        }
    }
    if (record?.role === 'agent' && isHiddenOrNonRenderableAgentRecord(record.content)) {
        return emptyTimelineSignals({ ignored: true })
    }
    const target = record?.content ?? content
    const titleChange = findTitleChangeInvocation(target)
    if (titleChange) {
        return emptyTimelineSignals({
            hasEvent: true,
            hasText: true,
            text: formatTitleChangeText(titleChange.title),
            titleChange,
            toolCallIds: titleChange.callId ? [titleChange.callId] : []
        })
    }
    const scanned = scanTimelineValue(target, 0, textParts, summary, toolCallIds, toolResultIds)
    const text = [...new Set(textParts)].join('\n\n').trim()
    return {
        ignored: false,
        hasWork: scanned.hasWork,
        hasEvent: scanned.hasEvent,
        hasText: text.length > 0,
        text,
        summary,
        toolCallIds: [...toolCallIds],
        toolResultIds: [...toolResultIds]
    }
}

function getCodexSnapshotKey(content: unknown): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (record?.role !== 'agent' || !isObject(record.content) || record.content.type !== 'codex') return null
    if (!isObject(record.content.data)) return null
    const type = asString(record.content.data.type)
    if (type !== 'message' && type !== 'reasoning') return null
    const streamId = asString(record.content.data.id)
    return streamId ? `${type}:${streamId}` : null
}

function summarizeTimelineMessages(
    messages: ReturnType<Store['messages']['getMessagesBySeqRange']>
): TimelineSummaryItem[] {
    const items: TimelineSummaryItem[] = []
    const latestSnapshotSeq = new Map<string, number>()
    for (const message of messages) {
        const key = getCodexSnapshotKey(message.content)
        if (key) latestSnapshotSeq.set(key, message.seq)
    }
    const visibleMessages = messages.filter((message) => {
        const key = getCodexSnapshotKey(message.content)
        return !key || latestSnapshotSeq.get(key) === message.seq
    })
    let work: TimelineSummaryItem | null = null
    let workToolCallIds = new Set<string>()
    let workToolResultIds = new Set<string>()
    const titleChangeCallIds = new Set<string>()
    const pendingTitleChangeSummaries = new Set<string>()

    const consumeTitleChangeSummary = (text: string): boolean => {
        const normalized = text.trim()
        if (!normalized) return false
        for (const title of pendingTitleChangeSummaries) {
            if (normalized !== title && normalized !== formatTitleChangeText(title)) continue
            pendingTitleChangeSummaries.delete(title)
            return true
        }
        return false
    }

    const flushWork = (completionAt?: number) => {
        if (!work) return
        const runningCount = [...workToolCallIds].filter((id) => !workToolResultIds.has(id)).length
        if (work.work) {
            work.work.runningCount = runningCount
            const invocationCount = new Set([...workToolCallIds, ...workToolResultIds]).size
            const nonInvocationTools = Math.max(0, work.work.toolCount - workToolCallIds.size)
            work.work.toolCount = Math.max(work.work.toolCount, invocationCount + nonInvocationTools)
            // A timeline item is already one folded work group. Do not add
            // one group for every tool result; that inflates this counter to
            // call + result count and makes the compact summary misleading.
            work.work.toolGroupCount = work.work.toolCount > 0 ? 1 : 0
            if (runningCount > 0) {
                work.completedAt = null
                work.durationMs = null
            } else if (
                typeof completionAt === 'number'
                && Number.isFinite(completionAt)
                && completionAt >= work.createdAt
            ) {
                work.completedAt = Math.max(work.completedAt ?? work.createdAt, completionAt)
                work.durationMs = Math.max(work.durationMs ?? 0, completionAt - work.createdAt)
            }
        }
        items.push(work)
        work = null
        workToolCallIds = new Set()
        workToolResultIds = new Set()
    }

    for (const message of visibleMessages) {
        const role = unwrapRoleWrappedRecordEnvelope(message.content)?.role
        const signals = classifyTimelineMessage(message.content)
        if (signals.ignored) continue

        // MCP tool results for change_title are implementation details. The
        // invocation itself becomes the standalone title-change event below.
        const isTitleChangeResultOnly = signals.toolResultIds.length > 0
            && signals.toolResultIds.every((id) => titleChangeCallIds.has(id))
            && !signals.hasText
            && !signals.hasEvent
            && signals.summary.reasoningCount === 0
            && signals.summary.reviewCount === 0
            && signals.summary.toolCount === 0
        if (isTitleChangeResultOnly) continue

        if (signals.titleChange) {
            flushWork(message.createdAt)
            items.push({
                id: 'event:' + message.id,
                kind: 'event',
                createdAt: message.createdAt,
                seqStart: message.seq,
                seqEnd: message.seq,
                text: signals.text
            })
            pendingTitleChangeSummaries.clear()
            if (signals.titleChange.title.trim()) {
                pendingTitleChangeSummaries.add(signals.titleChange.title.trim())
            }
            if (signals.titleChange.callId) titleChangeCallIds.add(signals.titleChange.callId)
            continue
        }

        if (role === 'user' && !signals.hasWork) {
            if (!signals.hasText) continue
            flushWork()
            items.push({
                id: 'user:' + message.id,
                kind: 'user',
                createdAt: message.createdAt,
                seqStart: message.seq,
                seqEnd: message.seq,
                text: extractUserText(message.content)
            })
            pendingTitleChangeSummaries.clear()
            continue
        }

        if (signals.hasWork) {
            // A single assistant payload may contain commentary followed by a
            // tool call. Keep the commentary visible outside the folded group;
            // the detail endpoint still returns the whole raw message range.
            if (signals.hasText) {
                const titleChange = consumeTitleChangeSummary(signals.text)
                flushWork(message.createdAt)
                items.push({
                    id: 'assistant:' + message.id,
                    kind: 'assistant',
                    createdAt: message.createdAt,
                    seqStart: message.seq,
                    seqEnd: message.seq,
                    text: signals.text,
                    ...(titleChange ? { titleChange: true } : {})
                })
                if (!titleChange) pendingTitleChangeSummaries.clear()
            }
            if (!signals.hasText) pendingTitleChangeSummaries.clear()
            if (!work) {
                work = {
                    id: 'work-group:' + message.seq + '-' + message.seq,
                    kind: 'work-group',
                    createdAt: message.createdAt,
                    lastActivityAt: message.createdAt,
                    seqStart: message.seq,
                    seqEnd: message.seq,
                    startedAt: message.createdAt,
                    completedAt: message.createdAt,
                    durationMs: 0,
                    work: signals.summary
                }
                workToolCallIds = new Set(signals.toolCallIds)
                workToolResultIds = new Set(signals.toolResultIds)
            } else {
                work.seqEnd = message.seq
                work.id = 'work-group:' + work.seqStart + '-' + work.seqEnd
                work.lastActivityAt = message.createdAt
                work.completedAt = message.createdAt
                work.durationMs = Math.max(0, message.createdAt - work.createdAt)
                const current = work.work ?? emptyTimelineSummary()
                for (const key of Object.keys(current) as Array<keyof TimelineWorkSummary>) {
                    current[key] += signals.summary[key]
                }
                work.work = current
                for (const id of signals.toolCallIds) workToolCallIds.add(id)
                for (const id of signals.toolResultIds) workToolResultIds.add(id)
            }
            continue
        }

        // Unknown/empty payloads are not visible Web blocks. They must not
        // split the surrounding execution group.
        if (!signals.hasText && !signals.hasEvent) continue

        flushWork(role === 'user' ? undefined : message.createdAt)
        if (signals.hasEvent) {
            items.push({
                id: 'event:' + message.id,
                kind: 'event',
                createdAt: message.createdAt,
                seqStart: message.seq,
                seqEnd: message.seq,
                text: signals.text
            })
            pendingTitleChangeSummaries.clear()
        } else if (signals.hasText) {
            const titleChange = consumeTitleChangeSummary(signals.text)
            items.push({
                id: 'assistant:' + message.id,
                kind: 'assistant',
                createdAt: message.createdAt,
                seqStart: message.seq,
                seqEnd: message.seq,
                text: signals.text,
                ...(titleChange ? { titleChange: true } : {})
            })
            if (!titleChange) pendingTitleChangeSummaries.clear()
        }
    }
    flushWork()
    return items
}

export class MessageService {
    private readonly timelineCache = new Map<string, TimelineCacheEntry>()
    constructor(
        private readonly store: Store,
        private readonly io: Server,
        private readonly publisher: EventPublisher,
        private readonly onSessionActivity?: (sessionId: string, updatedAt: number) => void
    ) {
    }

    getMessages(sessionId: string, limit: number = 200): DecryptedMessage[] {
        const stored = this.store.messages.getMessages(sessionId, limit)
        return stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }))
    }

    getConversationOutline(sessionId: string): ConversationOutlineEntry[] {
        return this.store.messages.getUserTurnMessages(sessionId)
            .filter((message) => !isAutomaticContinuationMeta(unwrapRoleWrappedRecordEnvelope(message.content)?.meta))
            .map((message) => ({
            messageId: message.id,
            text: extractUserText(message.content),
            createdAt: message.createdAt,
            seq: message.seq
            }))
    }

    private readTimelineMessages(sessionId: string, startSeq: number, endSeq: number) {
        const messages: ReturnType<Store['messages']['getMessagesBySeqRange']> = []
        let cursor = startSeq
        while (cursor <= endSeq) {
            const rows = this.store.messages.getMessagesBySeqRange(sessionId, {
                startSeq: cursor,
                endSeq,
                limit: TIMELINE_RAW_SCAN_LIMIT
            })
            if (rows.length === 0) break
            messages.push(...rows)
            const next = rows.at(-1)!.seq + 1
            if (next <= cursor) break
            cursor = next
        }
        return messages
    }

    /** 缓存紧凑投影，追加消息只重算最后一个用户轮次；不持有原始工具输出。 */
    private getTimelineProjection(sessionId: string): TimelineCacheEntry {
        const messageStore = this.store.messages as Store['messages'] & {
            getMessageEpoch?: (id: string) => number
            getMaxSeq?: (id: string) => number
        }
        const epoch = messageStore.getMessageEpoch?.(sessionId) ?? 0
        const maxSeq = messageStore.getMaxSeq?.(sessionId)
            ?? this.store.messages.getMessagesBySeqRange(sessionId, { limit: 1 })[0]?.seq
            ?? 0
        const cached = this.timelineCache.get(sessionId)
        if (cached?.epoch === epoch && cached.maxSeq === maxSeq) return cached

        const canAppend = cached?.epoch === epoch && cached.maxSeq < maxSeq
        const lastUser = canAppend
            ? [...cached.items].reverse().find((item) => item.kind === 'user')
            : undefined
        const startSeq = lastUser?.seqStart ?? 1
        const prefix = canAppend ? cached.items.filter((item) => item.seqEnd < startSeq) : []
        const items = [...prefix, ...summarizeTimelineMessages(this.readTimelineMessages(sessionId, startSeq, maxSeq))]
        const entry = { epoch, maxSeq, items }
        this.timelineCache.delete(sessionId)
        this.timelineCache.set(sessionId, entry)
        if (this.timelineCache.size > TIMELINE_CACHE_SESSIONS) {
            this.timelineCache.delete(this.timelineCache.keys().next().value!)
        }
        return entry
    }

    getTimelineSummary(
        sessionId: string,
        options: { limit?: number; beforeSeq?: number | null; aroundSeq?: number | null } = {}
    ): TimelineSummaryResponse {
        const limit = Math.min(
            TIMELINE_MAX_LIMIT,
            Math.max(1, Math.floor(options.limit ?? TIMELINE_DEFAULT_LIMIT))
        )
        const projection = this.getTimelineProjection(sessionId)
        const allItems = projection.items
        let start = Math.max(0, allItems.length - limit)
        let end = allItems.length
        if (options.beforeSeq != null) {
            const boundary = allItems.findIndex((item) => item.seqStart >= options.beforeSeq!)
            end = boundary === -1 ? allItems.length : boundary
            start = Math.max(0, end - limit)
        } else if (options.aroundSeq != null) {
            let target = allItems.findIndex((item) => item.seqStart <= options.aroundSeq! && item.seqEnd >= options.aroundSeq!)
            if (target === -1) {
                target = allItems.findIndex((item) => item.seqStart >= options.aroundSeq!)
                if (target === -1 && allItems.length > 0) target = allItems.length - 1
            }
            if (target === -1) {
                start = end = 0
            } else {
                start = Math.max(0, target - Math.floor(limit / 4))
                end = Math.min(allItems.length, start + limit)
            }
        }
        const items = allItems.slice(start, end)

        return {
            items,
            page: {
                limit,
                nextBeforeSeq: items[0]?.seqStart ?? null,
                hasMore: start > 0,
                epoch: projection.epoch
            }
        }
    }

    getTimelineDetails(sessionId: string, groupId: string): TimelineDetailsResponse {
        const match = /^work-group:(\d+)-(\d+)$/.exec(groupId)
        if (!match) {
            throw new Error('Invalid timeline group')
        }
        const startSeq = Number(match[1])
        const endSeq = Number(match[2])
        if (!Number.isSafeInteger(startSeq) || !Number.isSafeInteger(endSeq) || startSeq < 1 || endSeq < startSeq) {
            throw new Error('Invalid timeline group range')
        }

        // 展开接口只读取本工作组，跨 DB 查询批次也一次返回，不触发主列表分页。
        const messages = this.readTimelineMessages(sessionId, startSeq, endSeq)
        const group = summarizeTimelineMessages(messages).find((item) => item.kind === 'work-group') ?? {
            id: groupId,
            kind: 'work-group' as const,
            createdAt: messages[0]?.createdAt ?? Date.now(),
            lastActivityAt: messages.at(-1)?.createdAt ?? null,
            seqStart: startSeq,
            seqEnd: endSeq,
            startedAt: messages[0]?.createdAt ?? null,
            completedAt: messages.at(-1)?.createdAt ?? null,
            durationMs: messages.length > 1
                ? Math.max(0, (messages.at(-1)?.createdAt ?? 0) - (messages[0]?.createdAt ?? 0))
                : 0,
            work: emptyTimelineSummary()
        }

        return {
            group,
            messages: messages.map(toDecryptedMessage),
            page: {
                limit: TIMELINE_DETAIL_LIMIT,
                nextBeforeSeq: null,
                hasMore: messages.length >= TIMELINE_DETAIL_LIMIT
            }
        }
    }

    /** Return the hub's authoritative invocation state for client local ids. */
    getQueuedState(sessionId: string, localIds: string[]): QueuedStateResponse {
        const states = this.store.messages.getLocalMessageStates(sessionId, [...new Set(localIds)])
        return {
            queuedLocalIds: states
                .filter((state) => state.invokedAt === null)
                .map((state) => state.localId),
            invokedLocalMessages: states.flatMap((state) => state.invokedAt === null
                ? []
                : [{ localId: state.localId, invokedAt: state.invokedAt }])
        }
    }

    getRollbackTurnsAfterMessage(sessionId: string, messageId: string): number | null {
        const turns = this.store.messages.getUserTurnMessages(sessionId)
        const target = (() => {
            const direct = this.store.messages.getMessageByIdOrLocalId(sessionId, messageId)
            if (direct) return direct

            // Accept assistant-ui's rendered ids as a defensive fallback for
            // an older cached Web bundle: `assistant:<hub-id>:<part-index>`.
            const prefixEnd = messageId.indexOf(':')
            if (prefixEnd <= 0) return null
            const hubMessageId = messageId.slice(prefixEnd + 1).split(':', 1)[0]
            return this.store.messages.getMessageByIdOrLocalId(sessionId, hubMessageId)
        })()
        if (!target) return null

        // A queued user message has not reached the native transcript yet, so
        // it cannot be a valid fork boundary.  Do not silently fall back to
        // the previous invoked turn in that case.
        if (target.invokedAt === null && target.localId !== null) return null

        // The Web action is rendered on both user and assistant cards.  The
        // native Codex fork API rolls back complete user turns, therefore an
        // assistant/tool message resolves to the latest invoked user turn at
        // or before that message's transcript position.
        let index = -1
        for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
            if (turns[turnIndex].seq <= target.seq) {
                index = turnIndex
                break
            }
        }
        return index < 0 ? null : turns.length - index - 1
    }

    getMessagesPage(sessionId: string, options: LegacyMessagesOptions): LegacyMessagesResponse
    getMessagesPage(sessionId: string, options: IncrementalMessagesOptions): IncrementalMessagesResponse
    getMessagesPage(
        sessionId: string,
        options: LegacyMessagesOptions | IncrementalMessagesOptions
    ): LegacyMessagesResponse | IncrementalMessagesResponse {
        if ('beforeSeq' in options) {
            return this.getLegacyMessagesPage(sessionId, options)
        }
        return this.getIncrementalMessagesPage(sessionId, options)
    }

    private getLegacyMessagesPage(sessionId: string, options: LegacyMessagesOptions): LegacyMessagesResponse {
        const stored = this.store.messages.getMessages(sessionId, options.limit, options.beforeSeq ?? undefined)
        const messages: DecryptedMessage[] = stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt,
            invokedAt: message.invokedAt
        }))

        let oldestSeq: number | null = null
        for (const message of messages) {
            if (typeof message.seq !== 'number') continue
            if (oldestSeq === null || message.seq < oldestSeq) {
                oldestSeq = message.seq
            }
        }

        const nextBeforeSeq = oldestSeq
        const hasMore = nextBeforeSeq !== null
            && this.store.messages.getMessages(sessionId, 1, nextBeforeSeq).length > 0

        return {
            messages,
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore
            }
        }
    }

    getMessagesPageByPosition(
        sessionId: string,
        options: { limit: number; before?: { at: number; seq: number } | null }
    ): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            nextBeforeSeq: number | null
            nextBeforeAt: number | null
            hasMore: boolean
        }
    } {
        const before = options.before ?? undefined
        const pageRows = this.store.messages.getMessagesByPosition(sessionId, options.limit, before)

        // Latest-page request (no cursor): also include uninvoked local user messages
        // out-of-band, so refresh / secondary clients can still see queued rows even
        // when their position key (createdAt) places them outside the latest page.
        // The cursor stays anchored to pageRows so out-of-band rows don't affect
        // pagination of older pages.
        const queuedRows = before === undefined
            ? this.store.messages.getUninvokedLocalMessages(sessionId)
            : []

        const byId = new Map<string, typeof pageRows[number]>()
        for (const row of pageRows) byId.set(row.id, row)
        for (const row of queuedRows) byId.set(row.id, row)

        const stored = [...byId.values()].sort((a, b) => {
            const at = (a.invokedAt ?? a.createdAt) - (b.invokedAt ?? b.createdAt)
            return at !== 0 ? at : a.seq - b.seq
        })

        const messages: DecryptedMessage[] = stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt,
            invokedAt: message.invokedAt
        }))

        // The cursor is the oldest row in the actual position-ordered page (pageRows[0]).
        // Out-of-band queued rows are not part of the cursor — they are pinned to
        // every latest-page response.
        const oldest = pageRows[0] ?? null
        const oldestSeq: number | null = oldest?.seq ?? null
        const oldestPositionAt: number | null = oldest
            ? oldest.invokedAt ?? oldest.createdAt
            : null

        const hasMore = oldestSeq !== null && oldestPositionAt !== null
            && this.store.messages.getMessagesByPosition(
                sessionId,
                1,
                { at: oldestPositionAt, seq: oldestSeq }
            ).length > 0

        return {
            messages,
            page: {
                limit: options.limit,
                nextBeforeSeq: oldestSeq,
                nextBeforeAt: oldestPositionAt,
                hasMore
            }
        }
    }

    /**
     * Read the message window using a composite display-position cursor.
     * `after` requests only the incremental tail; an epoch mismatch returns a
     * latest page with `reset: true` so clients can replace stale cached rows.
     */
    getIncrementalMessagesPage(
        sessionId: string,
        options: IncrementalMessagesOptions
    ): IncrementalMessagesResponse {
        const epoch = this.store.messages.getMessageEpoch(sessionId)
        if (options.after) {
            if (options.epoch !== undefined && options.epoch !== null && options.epoch !== epoch) {
                return this.getLatestOrBeforeMessagesPage(sessionId, options.limit, null, epoch, true)
            }
            return this.getAfterMessagesPage(
                sessionId,
                options.limit,
                options.after,
                options.until ?? null,
                epoch
            )
        }
        return this.getLatestOrBeforeMessagesPage(
            sessionId,
            options.limit,
            options.before ?? null,
            epoch,
            false
        )
    }

    private getLatestOrBeforeMessagesPage(
        sessionId: string,
        limit: number,
        requestedBefore: MessagePosition | null,
        epoch: number,
        reset: boolean
    ): IncrementalMessagesResponse {
        const direction = requestedBefore ? 'before' as const : 'latest' as const
        const snapshotHead = this.store.messages.getNewestMessagePosition(sessionId)
        let pageRows = this.store.messages.getMessagesByPosition(sessionId, limit, requestedBefore ?? undefined)
        const queuedRows = requestedBefore === null
            ? this.store.messages.getUninvokedLocalMessages(sessionId)
            : []

        const byId = new Map<string, typeof pageRows[number]>()
        for (const row of pageRows) byId.set(row.id, row)
        for (const row of queuedRows) byId.set(row.id, row)
        let messages = [...byId.values()]
            .sort((a, b) => {
                const at = (a.invokedAt ?? a.createdAt) - (b.invokedAt ?? b.createdAt)
                return at !== 0 ? at : a.seq - b.seq
            })
            .map(toDecryptedMessage)

        let oldest = pageRows[0] ?? null
        let oldestPosition: MessagePosition | null = oldest
            ? { at: oldest.invokedAt ?? oldest.createdAt, seq: oldest.seq }
            : null
        let hasMore = oldestPosition !== null
            && this.store.messages.getMessagesByPosition(sessionId, 1, oldestPosition).length > 0

        // A page containing only filtered/queued rows should still advance over
        // older rows; keep the cursor anchored to the actual database page.
        while (messages.length === 0 && hasMore && oldestPosition) {
            pageRows = this.store.messages.getMessagesByPosition(sessionId, limit, oldestPosition)
            messages = pageRows
                .sort((a, b) => {
                    const at = (a.invokedAt ?? a.createdAt) - (b.invokedAt ?? b.createdAt)
                    return at !== 0 ? at : a.seq - b.seq
                })
                .map(toDecryptedMessage)
            oldest = pageRows[0] ?? null
            oldestPosition = oldest
                ? { at: oldest.invokedAt ?? oldest.createdAt, seq: oldest.seq }
                : null
            hasMore = oldestPosition !== null
                && this.store.messages.getMessagesByPosition(sessionId, 1, oldestPosition).length > 0
        }

        return {
            messages,
            page: {
                direction,
                limit,
                epoch,
                reset,
                nextBeforeSeq: oldestPosition?.seq ?? null,
                nextBeforeAt: oldestPosition?.at ?? null,
                nextAfterSeq: null,
                nextAfterAt: null,
                snapshotHeadSeq: snapshotHead?.seq ?? null,
                snapshotHeadAt: snapshotHead?.at ?? null,
                hasMore
            }
        }
    }

    private getAfterMessagesPage(
        sessionId: string,
        limit: number,
        after: MessagePosition,
        requestedUntil: MessagePosition | null,
        epoch: number
    ): IncrementalMessagesResponse {
        const currentHead = this.store.messages.getNewestMessagePosition(sessionId)
        const snapshotHead = currentHead && requestedUntil
            ? (comparePosition(requestedUntil, currentHead) <= 0 ? requestedUntil : currentHead)
            : requestedUntil ?? currentHead

        if (!snapshotHead || comparePosition(snapshotHead, after) <= 0) {
            return {
                messages: [],
                page: {
                    direction: 'after',
                    limit,
                    epoch,
                    reset: false,
                    nextBeforeSeq: null,
                    nextBeforeAt: null,
                    nextAfterSeq: after.seq,
                    nextAfterAt: after.at,
                    snapshotHeadSeq: snapshotHead?.seq ?? null,
                    snapshotHeadAt: snapshotHead?.at ?? null,
                    hasMore: false
                }
            }
        }

        const pageRows = this.store.messages.getMessagesAfterPosition(
            sessionId,
            limit,
            after,
            snapshotHead
        )
        const last = pageRows[pageRows.length - 1] ?? null
        const nextAfter = last
            ? { at: last.invokedAt ?? last.createdAt, seq: last.seq }
            : snapshotHead
        const hasMore = last !== null && comparePosition(nextAfter, snapshotHead) < 0

        return {
            messages: pageRows.map(toDecryptedMessage),
            page: {
                direction: 'after',
                limit,
                epoch,
                reset: false,
                nextBeforeSeq: null,
                nextBeforeAt: null,
                nextAfterSeq: nextAfter.seq,
                nextAfterAt: nextAfter.at,
                snapshotHeadSeq: snapshotHead.seq,
                snapshotHeadAt: snapshotHead.at,
                hasMore
            }
        }
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const stored = this.store.messages.getMessagesAfter(sessionId, options.afterSeq, options.limit)
        return stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt,
            invokedAt: message.invokedAt
        }))
    }

    async cancelQueuedMessage(
        sessionId: string,
        messageId: string
    ): Promise<CancelQueuedMessageResult> {
        // Phase 1: look up the row WITHOUT deleting it.
        // This lets us ask the CLI first and only DELETE if the CLI confirms removal.
        const lookup = this.store.messages.lookupQueuedMessage(sessionId, messageId)

        if (lookup.status === 'absent') {
            // Row not found — already cancelled or wrong id.
            return { status: 'cancelled', localId: null }
        }

        if (lookup.status === 'invoked') {
            // DB row already has invoked_at — CLI consumed it before we arrived.
            // Return the full invoked row so the web client can restore authoritative
            // state (with correct invokedAt) instead of a stale queued snapshot.
            return lookup
        }

        // Phase 2: row is still queued.  Ask the CLI whether it already shifted the item
        // (race window between collectBatch() shift and messages-consumed ack).
        const { localId, resolvedId } = lookup

        if (!localId) {
            // No localId — row exists but has no cancel path; treat as cancelled.
            this.store.messages.deleteQueuedMessageById(sessionId, resolvedId)
            this.publisher.emit({ type: 'message-cancelled', sessionId, messageId })
            return { status: 'cancelled', localId: null }
        }

        // Phase 2a: if no CLI socket is currently in the session room, the CLI is
        // offline and there is nobody to ack with.  Delete the row immediately so a
        // later CLI reconnect cannot pick it up via seq-backfill and re-enqueue the
        // cancelled message.
        //
        // TOCTOU note: deleteQueuedMessageById already has an invoked_at IS NULL guard,
        // so if a CLI socket joins between the cliCount read and the DELETE and wins the
        // race by calling markMessagesInvoked first, the DELETE becomes a no-op.
        // We re-read the row after the delete to detect that case and handle it exactly
        // like Race-B (ack returned removed:false).
        const roomName = `session:${sessionId}`
        const cliCount = this.io.of('/cli').adapter.rooms.get(roomName)?.size ?? 0
        if (cliCount === 0) {
            this.store.messages.deleteQueuedMessageById(sessionId, resolvedId)
            // Re-check: if CLI joined and invoked the message between our cliCount read
            // and the DELETE, the delete was a no-op and the row now has invoked_at set.
            const recheck = this.store.messages.lookupQueuedMessage(sessionId, resolvedId)
            if (recheck.status === 'invoked') {
                // CLI beat us — treat identically to Race-B (ack returned not-found).
                this.publisher.emit({
                    type: 'messages-consumed',
                    sessionId,
                    localIds: [localId],
                    invokedAt: recheck.message.invokedAt!,
                })
                return recheck
            }
            // Row is gone (absent) — clean cancel.
            this.publisher.emit({
                type: 'message-cancelled',
                sessionId,
                messageId,
                localId,
            })
            return { status: 'cancelled', localId }
        }

        const ackResult = await this.requestCliCancelAck(sessionId, localId, messageId, 500)

        if (ackResult === 'not-found' || ackResult === 'timeout') {
            // CLI could not remove the item — it was already shift()-ed or CLI is
            // offline.  Stamp invoked_at immediately so the message lands in the thread
            // as 'sent' instead of disappearing.  The agent's later assistant message
            // (if it produced one) joins the same thread normally.
            const invokedAt = Date.now()
            try {
                this.store.messages.markMessagesInvoked(sessionId, [localId], invokedAt)
            } catch (err) {
                console.error('cancelQueuedMessage: markMessagesInvoked failed', err)
                // DB write failed — let the HTTP 500 surface to the caller.
                throw err
            }
            // Notify all SSE subscribers (other open tabs) that this queued row is now
            // invoked so they remove it from the floating bar.  Without this emit, only
            // the tab that sent the DELETE request learns about the status change via the
            // HTTP response; every other subscriber keeps the row in the queued bar until
            // a refresh or a later event.  Mirrors the identical publish in the normal
            // CLI-driven path (sessionHandlers.ts messages-consumed handler).
            this.publisher.emit({
                type: 'messages-consumed',
                sessionId,
                localIds: [localId],
                invokedAt,
            })
            // Re-fetch the single row via lookupQueuedMessage to avoid the 200-row
            // pagination cap of getMessages.  After markMessagesInvoked the row will
            // have invoked_at set, so lookupQueuedMessage returns status='invoked'.
            const recheck = this.store.messages.lookupQueuedMessage(sessionId, localId)
            if (recheck.status === 'invoked') {
                return recheck
            }
            // Row absent from DB after markMessagesInvoked — edge case, treat as cancelled
            return { status: 'cancelled', localId }
        }

        // Phase 3: CLI confirmed removal.  Now DELETE the DB row and broadcast SSE.
        this.store.messages.deleteQueuedMessageById(sessionId, resolvedId)
        this.publisher.emit({
            type: 'message-cancelled',
            sessionId,
            messageId
        })

        return { status: 'cancelled', localId }
    }

    /**
     * Ask the CLI (via socket.io ack) whether it removed the in-memory queue item.
     * Returns 'removed', 'not-found', or 'timeout'.
     *
     * Re-uses the existing 'update' event channel with a cancel-queued-message body,
     * matching the ack pattern already used by rpcGateway
     * (socket.timeout(ms).emitWithAck / BroadcastOperator.timeout(ms).emit + ack cb).
     */
    private requestCliCancelAck(
        sessionId: string,
        localId: string,
        messageId: string,
        timeoutMs: number
    ): Promise<'removed' | 'not-found' | 'timeout'> {
        return new Promise((resolve) => {
            const room = this.io.of('/cli').to(`session:${sessionId}`)
            // socket.io v4 BroadcastOperator: .timeout(ms).emit(event, data, ackCb)
            // ack signature: (err: Error | null, responses: T[])
            room.timeout(timeoutMs).emit(
                'update',
                {
                    id: randomUUID(),
                    seq: 0,
                    createdAt: Date.now(),
                    body: {
                        t: 'cancel-queued-message' as const,
                        sid: sessionId,
                        messageId,
                        localId
                    }
                },
                (err: Error | null, responses: Array<{ removed: boolean }>) => {
                    // Check responses before err: in a reconnect overlap or any room with
                    // multiple CLI sockets, Socket.IO may set err (one socket timed out)
                    // while still delivering successful responses from the sockets that did
                    // ack. Any confirmed removal wins over the partial timeout.
                    const removed = responses?.some((r) => r.removed === true) ?? false
                    if (removed) {
                        resolve('removed')
                        return
                    }
                    if (err) {
                        resolve('timeout')
                        return
                    }
                    resolve('not-found')
                }
            )
        })
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: AttachmentMetadata[]
            sentFrom?: MessageSentFrom
            meta?: MessageMetaPatch
        }
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text,
                attachments: payload.attachments
            },
            meta: {
                ...payload.meta,
                sentFrom
            }
        }

        const msg = this.store.messages.addMessage(sessionId, content, payload.localId ?? undefined)
        this.onSessionActivity?.(sessionId, msg.createdAt)

        const update = {
            id: msg.id,
            seq: msg.seq,
            createdAt: msg.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message: {
                    id: msg.id,
                    seq: msg.seq,
                    createdAt: msg.createdAt,
                    localId: msg.localId,
                    content: msg.content
                }
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message: {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                content: msg.content,
                createdAt: msg.createdAt,
                invokedAt: msg.invokedAt
            }
        })
    }
}
