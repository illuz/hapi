import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { Session } from '@hapi/protocol/types'
import type { Store, StoredMessage } from '../store'

const MAX_EXCERPT_LINES = 500
const FALLBACK_EXCERPT_LINES = 100
const BACKFILL_MESSAGE_LIMIT_PER_SESSION = 20_000

function extractStrings(value: unknown, output: string[]): void {
    if (typeof value === 'string') {
        output.push(value)
        return
    }

    if (Array.isArray(value)) {
        for (const item of value) extractStrings(item, output)
        return
    }

    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>

    if (typeof record.text === 'string') output.push(record.text)
    if (typeof record.thinking === 'string') output.push(record.thinking)
    if (typeof record.summary === 'string') output.push(record.summary)
    if ('content' in record) extractStrings(record.content, output)
    if ('message' in record) extractStrings(record.message, output)
    if ('data' in record) extractStrings(record.data, output)
    if ('result' in record) extractStrings(record.result, output)
}

function extractText(value: unknown): string {
    const fragments: string[] = []
    extractStrings(value, fragments)
    return fragments.join('\n').trim()
}

function takeLastLines(text: string, limit: number): string {
    const lines = text.split(/\r?\n/g)
    return lines.slice(Math.max(0, lines.length - limit)).join('\n').trim()
}

function getProjectHost(session: Session): string | null {
    const host = session.metadata?.host?.trim()
    return host || null
}

function getSessionTitle(session: Session): string {
    if (session.metadata?.name?.trim()) return session.metadata.name.trim()
    if (session.metadata?.summary?.text?.trim()) return session.metadata.summary.text.trim()
    if (session.metadata?.path?.trim()) {
        const parts = session.metadata.path.split(/[\\/]+/).filter(Boolean)
        return parts[parts.length - 1] ?? session.metadata.path
    }
    return session.id.slice(0, 8)
}

function getMessageText(message: StoredMessage): string {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    return extractText(record?.content ?? message.content)
}

function findLatestTextAgentMessage(agentMessages: StoredMessage[]): StoredMessage | null {
    for (let index = agentMessages.length - 1; index >= 0; index -= 1) {
        const message = agentMessages[index]
        if (getMessageText(message)) return message
    }
    return null
}

type TurnRecord = {
    userMessage: StoredMessage
    agentMessages: StoredMessage[]
}

function buildTurnRecordFromTrailingMessages(messages: StoredMessage[]): TurnRecord | null {
    const trailingAgentMessages: StoredMessage[] = []

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        if (!record) continue

        if (record.role === 'user') {
            return {
                userMessage: message,
                agentMessages: trailingAgentMessages.reverse()
            }
        }

        if (record.role === 'agent') {
            trailingAgentMessages.push(message)
        }
    }

    return null
}

function buildTurnRecords(messages: StoredMessage[]): TurnRecord[] {
    const turns: TurnRecord[] = []
    let currentUser: StoredMessage | null = null
    let agentMessages: StoredMessage[] = []

    const flush = () => {
        if (currentUser && agentMessages.length > 0) {
            turns.push({ userMessage: currentUser, agentMessages })
        }
        agentMessages = []
    }

    for (const message of messages) {
        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        if (!record) continue

        if (record.role === 'user') {
            flush()
            currentUser = message
            continue
        }

        if (record.role === 'agent' && currentUser) {
            agentMessages.push(message)
        }
    }

    flush()
    return turns
}

export class ConversationHistoryService {
    constructor(
        private readonly store: Store,
        private readonly getSession: (sessionId: string) => Session | undefined
    ) {}

    recordCompletion(sessionId: string): void {
        const session = this.getSession(sessionId)
        if (!session) return

        const messages = this.store.messages.getMessages(sessionId, 200)
        const turn = buildTurnRecordFromTrailingMessages(messages)
        if (!turn || turn.agentMessages.length === 0) return

        this.recordTurn(session, turn)
    }

    backfillRecent(sinceCreatedAt: number): { sessionsScanned: number; entriesAttempted: number } {
        const sessions = this.store.sessions.getSessions()
        let sessionsScanned = 0
        let entriesAttempted = 0

        for (const storedSession of sessions) {
            const session = this.getSession(storedSession.id)
            if (!session) continue

            const messages = this.store.messages.getMessagesSince(
                session.id,
                sinceCreatedAt,
                BACKFILL_MESSAGE_LIMIT_PER_SESSION
            )
            if (messages.length === 0) continue

            sessionsScanned += 1
            for (const turn of buildTurnRecords(messages)) {
                if (this.recordTurn(session, turn)) {
                    entriesAttempted += 1
                }
            }
        }

        return { sessionsScanned, entriesAttempted }
    }

    private recordTurn(session: Session, turn: TurnRecord): boolean {
        const userText = getMessageText(turn.userMessage)
        if (!userText) return false

        const latestAgent = findLatestTextAgentMessage(turn.agentMessages)
        let assistantExcerpt = ''
        let assistantMessageId: string | null = null

        if (latestAgent) {
            assistantExcerpt = takeLastLines(getMessageText(latestAgent), MAX_EXCERPT_LINES)
            assistantMessageId = latestAgent.id
        }

        if (!assistantExcerpt && turn.agentMessages.length > 0) {
            const combined = turn.agentMessages
                .map(getMessageText)
                .filter(Boolean)
                .join('\n')
            assistantExcerpt = takeLastLines(combined, FALLBACK_EXCERPT_LINES)
            assistantMessageId = turn.agentMessages[turn.agentMessages.length - 1]?.id ?? null
        }

        if (!assistantExcerpt) return false

        try {
            this.store.history.addEntry({
                namespace: session.namespace,
                sessionId: session.id,
                userMessageId: turn.userMessage.id,
                assistantMessageId,
                createdAt: latestAgent?.createdAt ?? turn.agentMessages[turn.agentMessages.length - 1]?.createdAt ?? Date.now(),
                title: getSessionTitle(session),
                projectPath: session.metadata?.path ?? null,
                projectHost: getProjectHost(session),
                markerColor: session.markerColor,
                userText: takeLastLines(userText, MAX_EXCERPT_LINES),
                assistantExcerpt
            })
            return true
        } catch (error) {
            console.error('Failed to record conversation history:', error)
            return false
        }
    }
}
