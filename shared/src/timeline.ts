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
}

export type TimelineSummaryItem = {
    id: string
    kind: 'user' | 'assistant' | 'work-group' | 'event'
    createdAt: number
    seqStart: number
    seqEnd: number
    text?: string
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
