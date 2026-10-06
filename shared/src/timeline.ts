import type { DecryptedMessage } from './schemas'

/** Compact summary of one execution group shown before its details are opened. */
export type TimelineWorkSummary = {
    reasoningCount: number
    reviewCount: number
    eventCount: number
    toolGroupCount: number
    toolCount: number
    errorCount: number
    runningCount: number
    pendingCount: number
    /** Interactive tool calls that still require an answer from the user. */
    waitingForInputCount?: number
}

export type TimelineSummaryItem = {
    id: string
    kind: 'user' | 'assistant' | 'work-group' | 'event'
    createdAt: number
    /** Last persisted message timestamp in the group, even when a tool result is missing. */
    lastActivityAt?: number | null
    seqStart: number
    seqEnd: number
    text?: string
    /** The assistant text is the title returned by Hapi's title tool. */
    titleChange?: boolean
    startedAt?: number | null
    completedAt?: number | null
    durationMs?: number | null
    work?: TimelineWorkSummary
}

export type TimelineSummaryResponse = {
    items: TimelineSummaryItem[]
    page: {
        limit: number
        nextBeforeSeq: number | null
        hasMore: boolean
        epoch?: number
    }
}

export type TimelineDetailsResponse = {
    group: TimelineSummaryItem
    messages: DecryptedMessage[]
    page: {
        limit: number
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}
