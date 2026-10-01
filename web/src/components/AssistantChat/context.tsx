import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import type { ApiClient } from '@/api/client'
import type { TerminalToolDisplayMode } from '@/hooks/useTerminalToolDisplayMode'
import type { SessionMetadataSummary } from '@/types/api'

export type HistoryLoadOptions = {
    maxPages?: number
}

export type HappyChatContextValue = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    terminalToolDisplayMode: TerminalToolDisplayMode
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onForkMessage?: (messageId: string) => void | Promise<void>
    hasMoreMessages?: boolean
    isSyncingTail?: boolean
    isLoadingMoreMessages?: boolean
    loadOlderMessagesPreservingScroll?: (options?: HistoryLoadOptions) => Promise<'loaded' | 'transient-stop' | 'terminal-stop' | 'failed'>
    loadWorkGroupDetails?: (groupId: string) => Promise<'loaded' | 'failed'>
}

const HappyChatContext = createContext<HappyChatContextValue | null>(null)

export function HappyChatProvider(props: { value: HappyChatContextValue; children: ReactNode }) {
    return (
        <HappyChatContext.Provider value={props.value}>
            {props.children}
        </HappyChatContext.Provider>
    )
}

export function useHappyChatContext(): HappyChatContextValue {
    const ctx = useContext(HappyChatContext)
    if (!ctx) {
        throw new Error('HappyChatContext is missing')
    }
    return ctx
}
