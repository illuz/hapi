import {
    getLastAssistantLinesFromMessages,
    normalizeAutoContinueSettings,
    shouldAutoContinue,
    type AutoContinueSettings
} from '@hapi/protocol/autoContinue'
import type { Session } from '@hapi/protocol/types'
import type { Store } from '../store'

type AutoContinueDeps = {
    store: Store
    getSession: (sessionId: string) => Session | undefined
    switchSession: (sessionId: string, to: 'remote' | 'local') => Promise<void>
    sendMessage: (sessionId: string, payload: { text: string; sentFrom: 'auto-continue' }) => Promise<void>
    updateSettings: (sessionId: string, settings: AutoContinueSettings) => Promise<void>
}

export class AutoContinueService {
    private readonly lastCompletionKeyBySessionId = new Map<string, string>()
    private readonly inFlightSessionIds = new Set<string>()

    constructor(private readonly deps: AutoContinueDeps) {
    }

    async maybeHandleCompletion(sessionId: string): Promise<void> {
        if (this.inFlightSessionIds.has(sessionId)) {
            return
        }

        const session = this.deps.getSession(sessionId)
        const settings = normalizeAutoContinueSettings(session?.metadata?.autoContinue)
        if (!settings.enabled || settings.remaining <= 0) {
            return
        }

        const messages = this.deps.store.messages.getMessages(sessionId, 50)
        const lastMessage = messages[messages.length - 1]
        const completionKey = `${lastMessage?.id ?? 'none'}:${lastMessage?.seq ?? 0}`
        if (this.lastCompletionKeyBySessionId.get(sessionId) === completionKey) {
            return
        }

        const recentLines = getLastAssistantLinesFromMessages(messages)
        if (!shouldAutoContinue(recentLines, settings.keywords)) {
            return
        }

        this.inFlightSessionIds.add(sessionId)
        this.lastCompletionKeyBySessionId.set(sessionId, completionKey)

        try {
            if (session?.agentState?.controlledByUser) {
                await this.deps.switchSession(sessionId, 'remote')
            }

            await this.deps.sendMessage(sessionId, {
                text: settings.messageText,
                sentFrom: 'auto-continue'
            })

            const nextRemaining = Math.max(settings.remaining - 1, 0)
            await this.deps.updateSettings(sessionId, {
                ...settings,
                enabled: nextRemaining > 0,
                remaining: nextRemaining
            })
        } finally {
            this.inFlightSessionIds.delete(sessionId)
        }
    }
}
