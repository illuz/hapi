import { formatMessageTimestamp } from '@/chat/presentation'

export function MessageTimestamp(props: {
    createdAt: Date | null
    className?: string
}) {
    if (!props.createdAt) return null

    return (
        <time
            dateTime={props.createdAt.toISOString()}
            className={props.className ?? 'text-[11px] text-[var(--app-hint)] opacity-80'}
        >
            {formatMessageTimestamp(props.createdAt)}
        </time>
    )
}
