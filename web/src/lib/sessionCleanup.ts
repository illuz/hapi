import type { ApiClient } from '@/api/client'
import type { BulkSessionActionResponse, SessionSummary } from '@/types/api'
import { clearMessageWindow } from '@/lib/message-window-store'
import { queryKeys } from '@/lib/query-keys'

type SessionCleanupQueryClient = {
    removeQueries: (options: { queryKey: readonly unknown[] }) => void
    invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<void> | void
}

type CleanupInactiveSessionsOptions = {
    api: Pick<ApiClient, 'deleteSessions'> | null
    queryClient: SessionCleanupQueryClient
    inactiveSessions: SessionSummary[]
    selectedSessionId: string | null
    navigateToSessions: () => void
}

export async function cleanupInactiveSessions(options: CleanupInactiveSessionsOptions): Promise<BulkSessionActionResponse | void> {
    if (!options.api) {
        throw new Error('API unavailable')
    }
    if (options.inactiveSessions.length === 0) {
        return
    }

    const result = await options.api.deleteSessions(options.inactiveSessions.map((session) => session.id))

    for (const sessionId of result.successIds) {
        options.queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
        clearMessageWindow(sessionId)
    }

    if (options.selectedSessionId && result.successIds.includes(options.selectedSessionId)) {
        options.navigateToSessions()
    }

    await options.queryClient.invalidateQueries({ queryKey: queryKeys.sessions })

    return result
}
