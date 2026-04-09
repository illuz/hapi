import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { getContinueRound, getContinueSource } from '@/lib/continueRounds'
import { useTranslation } from '@/lib/use-translation'

export function HappyUserMessage() {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const role = useAssistantState(({ message }) => message.role)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'user') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const status = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAssistantState(({ message }) => {
        if (message.role !== 'user') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const createdAt = useAssistantState(({ message }) => message.createdAt ?? null)

    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const continueRound = getContinueRound(ctx.sessionId, localId)
    const continueSource = getContinueSource(ctx.sessionId, localId)

    const userBubbleClass = 'w-fit min-w-0 max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <div className="ml-auto flex w-full max-w-[92%] flex-col items-end gap-1">
                    <CliOutputBlock text={cliText} />
                    <MessageTimestamp createdAt={createdAt} />
                </div>
            </MessagePrimitive.Root>
        )
    }

    const hasText = text.length > 0
    const hasAttachments = attachments && attachments.length > 0

    return (
        <MessagePrimitive.Root className="flex flex-col items-end gap-1 px-1">
            <div className={`${userBubbleClass} group/msg`}>
                <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                        {continueRound ? (
                            <div className="mb-1 text-[11px] font-medium text-[var(--app-hint)]">
                                {t(
                                    continueSource === 'auto'
                                        ? 'session.continueBadgeAuto'
                                        : 'session.continueBadgeManual',
                                    { n: continueRound }
                                )}
                            </div>
                        ) : null}
                        {hasText && <LazyRainbowText text={text} />}
                        {hasAttachments && <MessageAttachments attachments={attachments} />}
                    </div>
                    {(hasText || status) && (
                        <div className="shrink-0 self-end pb-0.5 flex items-center gap-1">
                            {hasText && (
                                <button
                                    type="button"
                                    title="Copy"
                                    className="opacity-60 sm:opacity-0 sm:group-hover/msg:opacity-100 transition-[opacity,background-color] p-0.5 rounded hover:bg-[var(--app-subtle-bg)]"
                                    onClick={() => copy(text)}
                                >
                                    {copied
                                        ? <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                                        : <CopyIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />}
                                </button>
                            )}
                            {status && <MessageStatusIndicator status={status} onRetry={onRetry} />}
                        </div>
                    )}
                </div>
            </div>
            <MessageTimestamp createdAt={createdAt} />
        </MessagePrimitive.Root>
    )
}
