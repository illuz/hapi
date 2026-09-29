import { useCallback, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CheckIcon, CopyIcon, ShareIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function ForkIcon() {
    return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M6 3v12a5 5 0 0 0 5 5h7" />
            <path d="m14 16 4 4-4 4" />
            <path d="M6 8h8a4 4 0 0 0 4-4V3" />
        </svg>
    )
}

export function MessageActions(props: {
    copyText?: string
    messageElementId?: string
    showFork?: boolean
    onFork?: () => void | Promise<void>
    align?: 'start' | 'end'
    className?: string
}) {
    const { t } = useTranslation()
    const { sessionId } = useHappyChatContext()
    const { copied, copy } = useCopyToClipboard()
    const [forking, setForking] = useState(false)

    const handleShare = useCallback(async () => {
        const base = typeof window !== 'undefined' ? window.location.href.split('#')[0] : `/sessions/${sessionId}`
        const url = props.messageElementId ? `${base}#${props.messageElementId}` : base
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({ url })
                return
            } catch {
                return
            }
        }
        await copy(url)
    }, [copy, props.messageElementId, sessionId])

    const handleFork = useCallback(async () => {
        if (!props.onFork || forking) return
        setForking(true)
        try {
            await props.onFork()
        } finally {
            setForking(false)
        }
    }, [forking, props.onFork])

    if (!props.copyText && !props.messageElementId && !props.showFork) return null

    return (
        <div
            className={cn(
                'happy-message-actions mt-1 flex items-center gap-0.5 text-[var(--app-hint)]',
                props.align === 'end' ? 'justify-end' : 'justify-start',
                props.className
            )}
            data-message-actions="true"
        >
            {props.copyText ? (
                <button
                    type="button"
                    aria-label={t('message.action.copy')}
                    title={t('message.action.copy')}
                    className="rounded-md p-1 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    onClick={(event) => {
                        event.stopPropagation()
                        void copy(props.copyText!)
                    }}
                >
                    {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </button>
            ) : null}
            {props.messageElementId ? (
                <button
                    type="button"
                    aria-label={t('message.action.share')}
                    title={t('message.action.share')}
                    className="rounded-md p-1 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    onClick={(event) => {
                        event.stopPropagation()
                        void handleShare()
                    }}
                >
                    <ShareIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
            {props.showFork && props.onFork ? (
                <button
                    type="button"
                    aria-label={t('message.action.fork')}
                    title={t('message.action.fork')}
                    disabled={forking}
                    className="rounded-md p-1 transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-50"
                    onClick={(event) => {
                        event.stopPropagation()
                        void handleFork()
                    }}
                >
                    <ForkIcon />
                </button>
            ) : null}
        </div>
    )
}
