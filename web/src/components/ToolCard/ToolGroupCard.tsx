import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMetadataSummary } from '@/types/api'
import type { ToolCallBlock } from '@/chat/types'
import type { ToolGroupBlock } from '@/chat/toolGroups'
import { getCodexCommandActions, type CodexCommandAction } from '@/chat/codexCommandPresentation'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { ToolDetailDialogContent, ToolStatusIcon, toolStatusColorClass } from '@/components/ToolCard/ToolCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatGroupedHeaderSubtitle, formatGroupedHeaderTitle, safeGroupedLabelValue } from '@/components/ToolCard/groupedPresentation'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

export function getToolGroupTiming(tools: ToolCallBlock[], now: number) {
    const started = tools
        .filter((tool) => tool.tool.state !== 'pending')
        .map((tool) => tool.tool.startedAt ?? tool.tool.createdAt)
        .filter((value): value is number => Number.isFinite(value))
    const startedAt = started.length > 0 ? Math.min(...started) : null
    const running = tools.some((tool) => tool.tool.state === 'running')
    const finished = tools.length > 0 && tools.every((tool) => tool.tool.state === 'completed' || tool.tool.state === 'error')
    const completed = finished
        ? tools.map((tool) => tool.tool.completedAt).filter((value): value is number => Number.isFinite(value))
        : []
    const completedAt = finished && completed.length === tools.length ? Math.max(...completed) : null
    const end = running ? now : completedAt
    return {
        startedAt,
        completedAt,
        durationMs: startedAt != null && end != null && end >= startedAt ? end - startedAt : null,
        running
    }
}

function codexActionLabel(action: CodexCommandAction, t: (key: string, params?: Record<string, string | number>) => string) {
    if (action.type === 'read') return { title: t('toolGroup.codex.read'), detail: safeGroupedLabelValue(action.name ?? action.path) }
    if (action.type === 'listFiles') return { title: t('toolGroup.codex.list'), detail: safeGroupedLabelValue(action.path) }
    if (action.type === 'search') {
        const query = safeGroupedLabelValue(action.query)
        const path = safeGroupedLabelValue(action.path)
        return { title: t('toolGroup.codex.search'), detail: query && path ? `${query} · ${path}` : query ?? path }
    }
    return { title: t('toolGroup.friendly.genericCommand'), detail: null }
}

function Row(props: {
    block: ToolCallBlock
    metadata: SessionMetadataSummary | null
    label?: string
    detail?: string | null
    onClick: () => void
    now: number
}) {
    const { t } = useTranslation()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata
    }, t), [props.block, props.metadata, t])
    const timing = getToolGroupTiming([props.block], props.now)
    return (
        <button
            type="button"
            onClick={props.onClick}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            <span className={cn('shrink-0', toolStatusColorClass(props.block.tool.state))}>
                <ToolStatusIcon state={props.block.tool.state} />
            </span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--app-tool-card-accent)]">{presentation.icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--app-fg)]">{props.label ?? presentation.title}</span>
                {(props.detail ?? presentation.subtitle) ? <span className="block truncate font-mono text-xs text-[var(--app-tool-card-subtitle)]">{props.detail ?? presentation.subtitle}</span> : null}
            </span>
            {timing.durationMs != null ? <span className="shrink-0 font-mono text-xs text-[var(--app-hint)]">{formatDuration(timing.durationMs)}</span> : null}
        </button>
    )
}

export function ToolGroupCard(props: { block: ToolGroupBlock; metadata: SessionMetadataSummary | null }) {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const [open, setOpen] = useState(props.block.defaultOpen)
    const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
    const [now, setNow] = useState(() => Date.now())
    const [isHydratingHistory, setIsHydratingHistory] = useState(false)
    const [historyExhausted, setHistoryExhausted] = useState(false)
    const hydrationRunRef = useRef(0)
    const timing = getToolGroupTiming(props.block.tools, now)
    const isSingleTool = props.block.tools.length === 1

    useEffect(() => {
        setOpen(props.block.defaultOpen)
        setSelectedToolId(null)
        setIsHydratingHistory(false)
        setHistoryExhausted(false)
        hydrationRunRef.current += 1
    }, [props.block.id, props.block.defaultOpen])

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
        ctx.isSyncingTail,
        ctx.isLoadingMoreMessages,
        ctx.loadOlderMessagesPreservingScroll,
        historyExhausted,
        isHydratingHistory,
        open,
        props.block.needsOlderHistory
    ])

    useEffect(() => {
        if (!timing.running) return
        const interval = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(interval)
    }, [timing.running])

    const selectedTool = props.block.tools.find((tool) => tool.id === selectedToolId) ?? null
    const title = formatGroupedHeaderTitle(props.block, t)
    const subtitle = isSingleTool || props.block.presentationMode === 'codex-exploration'
        ? null
        : formatGroupedHeaderSubtitle(props.block, t)

    return (
        <Card className="overflow-hidden rounded-[20px] bg-[var(--app-tool-group-bg)] shadow-none" data-tool-group="true">
            <CardHeader className="space-y-0 p-3">
                <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                    <div className="flex items-center gap-2">
                        <span className={cn('text-[var(--app-hint)] transition-transform', open ? 'rotate-90' : null)}>›</span>
                        <CardTitle className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--app-fg)]">{title}</CardTitle>
                        {!isSingleTool ? <span className="shrink-0 text-xs text-[var(--app-hint)]">{props.block.summary.totalTools}</span> : null}
                        {timing.running ? <span className="shrink-0 text-[var(--app-link)]"><ToolStatusIcon state="running" /></span> : null}
                        {props.block.summary.pendingCount > 0 ? <span className="shrink-0 text-xs text-amber-700">{t('toolGroup.badge.pending', { n: props.block.summary.pendingCount })}</span> : null}
                        {props.block.summary.errorCount > 0 ? <span className="shrink-0 text-xs text-red-600">{t('toolGroup.errors', { n: props.block.summary.errorCount })}</span> : null}
                    </div>
                    <div className="ml-5 mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--app-hint)]">
                        {subtitle ? <span>{subtitle}</span> : null}
                        {timing.durationMs != null ? <span className="font-mono">{formatDuration(timing.durationMs)}</span> : null}
                    </div>
                </button>
            </CardHeader>
            {open ? (
                <CardContent className="flex flex-col gap-2 px-3 pb-3 pt-0">
                    {props.block.presentationMode === 'codex-exploration'
                        ? props.block.tools.flatMap((tool) => getCodexCommandActions(tool).map((action, index) => {
                            const label = codexActionLabel(action, t)
                            return <Row key={`${tool.id}:${index}`} block={tool} metadata={props.metadata} label={label.title} detail={label.detail} onClick={() => setSelectedToolId(tool.id)} now={now} />
                        }))
                        : props.block.tools.map((tool) => <Row key={tool.id} block={tool} metadata={props.metadata} onClick={() => setSelectedToolId(tool.id)} now={now} />)}
                    {isHydratingHistory ? <div className="text-xs text-[var(--app-hint)]">{t('toolGroup.loadingOlderHistory')}</div> : null}
                    {!isHydratingHistory && historyExhausted && props.block.needsOlderHistory ? <div className="text-xs text-[var(--app-hint)]">{t('toolGroup.historyUnavailable')}</div> : null}
                </CardContent>
            ) : null}
            <Dialog open={selectedTool !== null} onOpenChange={(value) => { if (!value) setSelectedToolId(null) }}>
                <DialogContent className="max-w-2xl" aria-describedby={undefined}>
                    {selectedTool ? (
                        <>
                            <DialogHeader><DialogTitle>{getToolPresentation({ toolName: selectedTool.tool.name, input: selectedTool.tool.input, result: selectedTool.tool.result, childrenCount: selectedTool.children.length, description: selectedTool.tool.description, metadata: props.metadata }, t).title}</DialogTitle></DialogHeader>
                            <ToolDetailDialogContent block={selectedTool} metadata={props.metadata} />
                        </>
                    ) : null}
                </DialogContent>
            </Dialog>
        </Card>
    )
}
