import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { getAssistantCopyText } from '@/components/AssistantChat/messages/assistantCopyText'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { MessageMetadata } from '@/components/AssistantChat/messages/MessageMetadata'
import { isNestedInteractiveEvent } from '@/components/AssistantChat/messages/metadataToggle'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { linkAssistantFilePaths } from '@/lib/filePathLinks'
import { MessageActions } from '@/components/AssistantChat/messages/MessageActions'
import { CodexReviewCard } from '@/components/AssistantChat/messages/CodexReviewCard'
import type { CodexReview } from '@/chat/types'

const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage
} as const

function AssistantMarkdownText() {
    const ctx = useHappyChatContext()
    const titleChange = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'assistant' && custom.titleChange === true
    })
    const shouldLinkFilePaths = useAssistantState(({ thread, message }) => {
        if (message.role !== 'assistant') return false
        if (message.status?.type === 'running') return false

        for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
            const candidate = thread.messages[index]
            if (candidate.role === 'assistant') {
                return candidate.id === message.id
            }
        }

        return false
    })

    const preprocess = useMemo(() => {
        if (!shouldLinkFilePaths) return undefined
        return (text: string) => linkAssistantFilePaths(text, ctx.sessionId)
    }, [ctx.sessionId, shouldLinkFilePaths])

    const markdown = <MarkdownText preprocess={preprocess} />
    if (!titleChange) return markdown

    return (
        <div className="flex min-w-0 items-start gap-1">
            <span aria-hidden="true" className="shrink-0 pt-0.5">✏️</span>
            <div className="min-w-0 flex-1">{markdown}</div>
        </div>
    )
}

const MESSAGE_PART_COMPONENTS = {
    Text: AssistantMarkdownText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: TOOL_COMPONENTS
} as const

export function HappyAssistantMessage() {
    const ctx = useHappyChatContext()
    const [showMetadata, setShowMetadata] = useState(false)
    const toggleMetadata = useCallback((event: MouseEvent<HTMLElement>) => {
        if (isNestedInteractiveEvent(event)) return
        setShowMetadata((open) => !open)
    }, [])
    const messageId = useAssistantState(({ message }) => message.id)
    const forkMessageId = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.sourceMessageId ?? message.id.replace(/^[^:]+:/, '').split(':', 1)[0] ?? message.id
    })
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const codexReview = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'codex-review' ? (custom.review as CodexReview | undefined) : undefined
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const toolOnly = useAssistantState(({ message }) => {
        if (message.role !== 'assistant') return false
        const parts = message.content
        return parts.length > 0 && parts.every((part) => part.type === 'tool-call')
    })
    // Tool-call cards use tool-use ids rather than persisted Hub message ids;
    // they are not valid standalone Codex fork boundaries.  Keep Fork on
    // assistant text/reasoning/review cards, whose ids can be resolved to the
    // containing transcript message by the Hub.
    const canForkMessage = Boolean(ctx.onForkMessage) && !toolOnly
    const copyText = useAssistantState(({ message }) => {
        if (message.role !== 'assistant') return ''
        return getAssistantCopyText(message.content)
    })

    const invokedAt = useAssistantState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.invokedAt)
    const durationMs = useAssistantState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.durationMs)
    const usage = useAssistantState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.usage)
    const messageModel = useAssistantState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.model)

    const hasMetadata = invokedAt != null
        || (typeof durationMs === 'number' && durationMs >= 0)
        || usage != null
        || (messageModel != null && messageModel !== '')

    const onMetadataKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (isNestedInteractiveEvent(event)) return
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setShowMetadata((open) => !open)
        }
    }, [])

    const rootClass = toolOnly
        ? 'py-1 min-w-0 max-w-full overflow-x-hidden'
        : 'px-1 min-w-0 max-w-full overflow-x-hidden'

    if (codexReview) {
        return (
            <MessagePrimitive.Root
                id={getConversationMessageAnchorId(messageId)}
                className="scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <CodexReviewCard review={codexReview} />
                <MessageActions
                    align="start"
                    messageElementId={getConversationMessageAnchorId(messageId)}
                    showFork={canForkMessage}
                    onFork={canForkMessage ? () => ctx.onForkMessage!(forkMessageId) : undefined}
                />
            </MessagePrimitive.Root>
        )
    }

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root
                id={getConversationMessageAnchorId(messageId)}
                className="scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <CliOutputBlock text={cliText} />
                {hasMetadata && (
                    <button
                        type="button"
                        onClick={() => setShowMetadata((open) => !open)}
                        aria-expanded={showMetadata}
                        className="mt-1 text-[10px] text-[var(--app-hint)] underline-offset-2 hover:text-[var(--app-fg)] hover:underline"
                    >
                        {showMetadata ? 'Hide metadata' : 'Show metadata'}
                    </button>
                )}
                {showMetadata && (
                    <MessageMetadata
                        invokedAt={invokedAt}
                        durationMs={durationMs}
                        usage={usage}
                        model={messageModel ?? null}
                        className="mt-1"
                    />
                )}
                <MessageActions
                    align="start"
                    copyText={cliText || undefined}
                    messageElementId={getConversationMessageAnchorId(messageId)}
                    showFork={canForkMessage}
                    onFork={canForkMessage ? () => ctx.onForkMessage!(forkMessageId) : undefined}
                />
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root
            id={getConversationMessageAnchorId(messageId)}
            className={`${rootClass} ${copyText ? 'group/msg' : ''} scroll-mt-4`}
        >
            <div className="flex items-start gap-2">
                <div
                    className={hasMetadata ? 'min-w-0 flex-1 cursor-pointer' : 'min-w-0 flex-1'}
                    onClick={hasMetadata ? toggleMetadata : undefined}
                    onKeyDown={hasMetadata ? onMetadataKeyDown : undefined}
                    role={hasMetadata ? 'button' : undefined}
                    tabIndex={hasMetadata ? 0 : undefined}
                    aria-expanded={hasMetadata ? showMetadata : undefined}
                >
                    <MessagePrimitive.Content components={MESSAGE_PART_COMPONENTS} />
                    {showMetadata && (
                        <MessageMetadata
                            invokedAt={invokedAt}
                            durationMs={durationMs}
                            usage={usage}
                            model={messageModel ?? null}
                            className="mt-1"
                        />
                    )}
                </div>
            </div>
            <MessageActions
                align="start"
                copyText={copyText || undefined}
                messageElementId={getConversationMessageAnchorId(messageId)}
                showFork={canForkMessage}
                onFork={canForkMessage ? () => ctx.onForkMessage!(forkMessageId) : undefined}
            />
        </MessagePrimitive.Root>
    )
}
