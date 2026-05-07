import { CodexAppServerClient } from '@/codex/codexAppServerClient'

type ForkCodexThreadOptions = {
    threadId: string
    rollbackTurns?: number
}

type ForkCodexThreadResult =
    | { success: true; threadId: string }
    | { success: false; error: string }

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export async function forkCodexThread(options: ForkCodexThreadOptions): Promise<ForkCodexThreadResult> {
    const client = new CodexAppServerClient()

    try {
        await client.connect()
        await client.initialize({
            clientInfo: {
                name: 'hapi-codex-fork-client',
                version: '1.0.0'
            },
            capabilities: {
                experimentalApi: true
            }
        })

        const forked = await client.forkThread({
            threadId: options.threadId,
            ephemeral: false,
            excludeTurns: false,
            persistExtendedHistory: true
        })

        const forkedThreadId = forked.thread?.id
        if (!forkedThreadId) {
            return {
                success: false,
                error: 'Codex fork did not return thread.id'
            }
        }

        if ((options.rollbackTurns ?? 0) > 0) {
            await client.rollbackThread({
                threadId: forkedThreadId,
                numTurns: options.rollbackTurns ?? 0
            })
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
