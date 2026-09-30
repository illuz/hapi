import { useEffect, useRef, useState } from 'react'
import type { SessionMetadataSummary } from '@/types/api'
import type { WorkGroupBlock, WorkGroupChildBlock } from '@/chat/workGroups'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { ToolGroupCard } from '@/components/ToolCard/ToolGroupCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { ToolStatusIcon } from '@/components/ToolCard/ToolCard'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

function WorkGroupChild(props: {
    block: WorkGroupChildBlock
    metadata: SessionMetadataSummary | null
}) {
    if (props.block.kind === 'tool-group') {
        return <ToolGroupCard block={props.block} metadata={props.metadata} />
    }

    return (
        <div className="rounded-2xl border border-[var(--app-divider)] bg-[var(--app-bg)] px-3.5 py-3 text-[13.5px] text-[var(--app-hint)]">
            <MarkdownRenderer content={props.block.text} className="aui-reasoning-content" />
        </div>
    )
}

export function WorkGroupCard(props: {
    block: WorkGroupBlock
    metadata: SessionMetadataSummary | null
}) {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const [open, setOpen] = useState(props.block.defaultOpen)
    const [now, setNow] = useState(() => Date.now())
    const [isHydratingHistory, setIsHydratingHistory] = useState(false)
    const [historyExhausted, setHistoryExhausted] = useState(false)
    const hydrationRunRef = useRef(0)

    const running = props.block.active || props.block.summary.runningCount > 0
    const pending = props.block.summary.pendingCount > 0
    const active = running || pending
    const timing = (() => {
        const startedAt = props.block.startedAt
        const completedAt = props.block.completedAt
        const durationMs = active && startedAt !== null
            ? Math.max(0, now - startedAt)
            : props.block.durationMs
                ?? (startedAt !== null && completedAt !== null && completedAt >= startedAt
                ? completedAt - startedAt
                    : null)
        return { durationMs }
    })()

    useEffect(() => {
        setOpen(props.block.defaultOpen)
        setIsHydratingHistory(false)
        setHistoryExhausted(false)
        hydrationRunRef.current += 1
    }, [props.block.defaultOpen, props.block.id])

    useEffect(() => {
        if (!open || !props.block.needsOlderHistory) {
            hydrationRunRef.current += 1
            setIsHydratingHistory(false)
            if (!props.block.needsOlderHistory) setHistoryExhausted(false)
            return
        }
        if (historyExhausted || isHydratingHistory || ctx.isSyncingTail || ctx.isLoadingMoreMessages) return
        if (!ctx.hasMoreMessages || !ctx.loadOlderMessagesPreservingScroll) {
            setHistoryExhausted(true)
            return
        }

        const runId = hydrationRunRef.current + 1
        hydrationRunRef.current = runId
        setIsHydratingHistory(true)
        void ctx.loadOlderMessagesPreservingScroll().then((result) => {
            if (hydrationRunRef.current !== runId) return
            setIsHydratingHistory(false)
            if (result === 'terminal-stop' || result === 'failed') setHistoryExhausted(true)
        }).catch(() => {
            if (hydrationRunRef.current !== runId) return
            setIsHydratingHistory(false)
            setHistoryExhausted(true)
        })
    }, [
        ctx.hasMoreMessages,
        ctx.isLoadingMoreMessages,
        ctx.isSyncingTail,
        ctx.loadOlderMessagesPreservingScroll,
        historyExhausted,
        isHydratingHistory,
        open,
        props.block.needsOlderHistory
    ])

    useEffect(() => {
        if (!active) return
        const interval = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(interval)
    }, [active])

    const title = active
        ? t('workGroup.working')
        : timing.durationMs !== null
            ? t('workGroup.workedFor', { duration: formatDuration(timing.durationMs) })
            : t('workGroup.title')
    const subtitleParts: string[] = []
    if (props.block.summary.reasoningCount > 0) {
        subtitleParts.push(t('workGroup.reasoning', { n: props.block.summary.reasoningCount }))
    }
    if (props.block.summary.toolCount > 0) {
        subtitleParts.push(t('workGroup.tools', { n: props.block.summary.toolCount }))
    }

    return (
        <Card className="overflow-hidden rounded-[20px] bg-[var(--app-reasoning-bg)] shadow-none" data-work-group="true">
            <CardHeader className="space-y-0 p-3">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                >
                    <div className="flex items-center gap-2">
                        <span className={cn('text-[var(--app-hint)] transition-transform', open ? 'rotate-90' : null)}>›</span>
                        <CardTitle className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--app-fg)]">{title}</CardTitle>
                        {running ? <span className="shrink-0 text-[var(--app-link)]"><ToolStatusIcon state="running" /></span> : null}
                        {props.block.summary.pendingCount > 0 ? <span className="shrink-0 text-xs text-amber-700">{t('workGroup.pending', { n: props.block.summary.pendingCount })}</span> : null}
                        {props.block.summary.errorCount > 0 ? <span className="shrink-0 text-xs text-red-600">{t('workGroup.errors', { n: props.block.summary.errorCount })}</span> : null}
                    </div>
                    {subtitleParts.length > 0 || timing.durationMs !== null ? (
                        <div className="ml-5 mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                            {subtitleParts.length > 0 ? <span>{subtitleParts.join(' · ')}</span> : null}
                            {timing.durationMs !== null ? <span className="font-mono">{formatDuration(timing.durationMs)}</span> : null}
                        </div>
                    ) : null}
                </button>
            </CardHeader>
            {open ? (
                <CardContent className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-3 pb-3 pt-0">
                    {props.block.blocks.map((block) => (
                        <WorkGroupChild key={block.id} block={block} metadata={props.metadata} />
                    ))}
                    {isHydratingHistory ? <div className="text-xs text-[var(--app-hint)]">{t('workGroup.loadingOlderHistory')}</div> : null}
                    {!isHydratingHistory && historyExhausted && props.block.needsOlderHistory ? <div className="text-xs text-[var(--app-hint)]">{t('workGroup.historyUnavailable')}</div> : null}
                </CardContent>
            ) : null}
        </Card>
    )
}
