import { CodexAppServerClient } from '@/codex/codexAppServerClient'
import { getNonOriginatingCodexClientInfo } from './utils/appServerClientInfo'

type ForkCodexThreadOptions = {
    threadId: string
    rollbackTurns?: number
}

type ForkCodexThreadResult =
    | { success: true; threadId: string }
    | { success: false; error: string }

const MAX_TURN_PAGE_SIZE = 100

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

async function resolveForkLastTurnId(
    client: CodexAppServerClient,
    threadId: string,
    rollbackTurns: number
): Promise<string> {
    let remainingTurns = rollbackTurns
    let cursor: string | undefined

    while (true) {
        const response = await client.listThreadTurns({
            threadId,
            ...(cursor ? { cursor } : {}),
            limit: Math.min(remainingTurns + 1, MAX_TURN_PAGE_SIZE),
            sortDirection: 'desc',
            itemsView: 'notLoaded'
        })
        const targetTurn = response.data[remainingTurns]
        if (targetTurn) {
            return targetTurn.id
        }

        remainingTurns -= response.data.length
        const nextCursor = response.nextCursor ?? undefined
        if (!nextCursor || nextCursor === cursor) {
            throw new Error(`Codex thread has fewer than ${rollbackTurns + 1} turns`)
        }
        cursor = nextCursor
    }
}

export async function forkCodexThread(options: ForkCodexThreadOptions): Promise<ForkCodexThreadResult> {
    const client = new CodexAppServerClient()

    try {
        await client.connect()
        await client.initialize({
            clientInfo: getNonOriginatingCodexClientInfo(),
            capabilities: {
                experimentalApi: true
            }
        })

        const rollbackTurns = options.rollbackTurns ?? 0
        const lastTurnId = rollbackTurns > 0
            ? await resolveForkLastTurnId(client, options.threadId, rollbackTurns)
            : undefined
        const forked = await client.forkThread({
            threadId: options.threadId,
            ...(lastTurnId ? { lastTurnId } : {}),
            ephemeral: false,
            excludeTurns: true
        })

        const forkedThreadId = forked.thread?.id
        if (!forkedThreadId) {
            return {
                success: false,
                error: 'Codex fork did not return thread.id'
            }
        }

        return {
            success: true,
            threadId: forkedThreadId
        }
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error)
        }
    } finally {
        await client.disconnect().catch(() => {})
    }
}
