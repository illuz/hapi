import type { ChatBlock, UserTextBlock } from '@/chat/types'
import type { ConversationOutlineEntry } from '@/types/api'

export type ConversationOutlineItem = {
    id: string
    targetMessageId: string
    kind: 'user'
    label: string
    createdAt: number
    forkFromMessageId: string
    seq?: number
    resumeSessionAt?: string
}

const MAX_OUTLINE_LABEL_LENGTH = 96

function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

export function truncateOutlineLabel(value: string, maxLength = MAX_OUTLINE_LABEL_LENGTH): string {
    const normalized = collapseWhitespace(value)
    if (normalized.length <= maxLength) {
        return normalized
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function getBlockMessageUuid(block: ChatBlock): string | undefined {
    if (
        block.kind === 'agent-text'
        || block.kind === 'agent-reasoning'
        || block.kind === 'cli-output'
        || block.kind === 'tool-call'
    ) {
        return block.messageUuid
    }
    return undefined
}

function findResumeSessionAt(blocks: readonly ChatBlock[], userBlockIndex: number): string | undefined {
    for (let i = userBlockIndex + 1; i < blocks.length; i += 1) {
        const uuid = getBlockMessageUuid(blocks[i])
        if (uuid) {
            return uuid
        }
    }
    return undefined
}

function userBlockToOutlineItem(
    block: UserTextBlock,
    resumeSessionAt?: string
): ConversationOutlineItem {
    const label = truncateOutlineLabel(block.text) || 'Empty message'
    return {
        id: `outline:user:${block.id}`,
        targetMessageId: `user:${block.id}`,
        kind: 'user',
        label,
        createdAt: block.createdAt,
        forkFromMessageId: block.id,
        resumeSessionAt
    }
}

export function buildConversationOutlineFromEntries(
    entries: readonly ConversationOutlineEntry[]
): ConversationOutlineItem[] {
    return entries.map((entry) => ({
        id: `outline:user:${entry.messageId}`,
        targetMessageId: `user:${entry.messageId}`,
        kind: 'user',
        label: truncateOutlineLabel(entry.text) || 'Empty message',
        createdAt: entry.createdAt,
        forkFromMessageId: entry.messageId,
        seq: entry.seq
    }))
}

export function buildConversationOutline(blocks: readonly ChatBlock[]): ConversationOutlineItem[] {
    const items: ConversationOutlineItem[] = []

    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index]
        if (block.kind === 'user-text') {
            items.push(userBlockToOutlineItem(block, findResumeSessionAt(blocks, index)))
        }
    }

    return items
}

export function getConversationMessageAnchorId(messageId: string): string {
    return `hapi-message-${messageId}`
}
