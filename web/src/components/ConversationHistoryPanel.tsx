import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ConversationHistoryEntry, Session } from '@/types/api'
import { useConversationHistory, type ConversationHistoryScope } from '@/hooks/queries/useConversationHistory'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CodeBlock } from '@/components/CodeBlock'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'

function CloseIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function getProjectName(projectPath: string | null): string | null {
    if (!projectPath) return null
    const parts = projectPath.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] ?? projectPath
}

function getProjectLabel(entry: { projectHost: string | null; projectPath: string | null }): string | null {
    const projectName = getProjectName(entry.projectPath)
    if (entry.projectHost && projectName) return `${projectName} - ${entry.projectHost}`
    return projectName ?? entry.projectHost
}

const HISTORY_SNIPPET_CONTEXT_BEFORE = 80
const HISTORY_SNIPPET_CONTEXT_AFTER = 420
const HISTORY_SNIPPET_FALLBACK_LENGTH = 520

function normalizeSnippetText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function getSearchTerms(query: string): string[] {
    const terms = query.trim().split(/\s+/).filter(Boolean)
    return Array.from(new Set(terms.map((term) => term.toLocaleLowerCase())))
}

function findFirstSearchMatch(text: string, terms: string[]): { index: number; term: string } | null {
    const lowerText = text.toLocaleLowerCase()
    let firstMatch: { index: number; term: string } | null = null

    for (const term of terms) {
        const index = lowerText.indexOf(term)
        if (index === -1) continue
        if (!firstMatch || index < firstMatch.index) {
            firstMatch = { index, term }
        }
    }

    return firstMatch
}

function truncateSnippet(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength).trimEnd()}…`
}

function buildSnippetAroundMatch(text: string, match: { index: number; term: string }): string {
    const start = Math.max(0, match.index - HISTORY_SNIPPET_CONTEXT_BEFORE)
    const end = Math.min(text.length, match.index + match.term.length + HISTORY_SNIPPET_CONTEXT_AFTER)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < text.length ? '…' : ''
    return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function getHistorySnippet(entry: ConversationHistoryEntry, query: string): { text: string; terms: string[] } {
    const terms = getSearchTerms(query)
    const contentText = [entry.userText, entry.assistantExcerpt].filter(Boolean).join(' ')
    const candidates = [
        contentText,
        entry.title,
        entry.projectPath ?? '',
        entry.projectHost ?? ''
    ].map(normalizeSnippetText).filter(Boolean)

    if (terms.length > 0) {
        for (const candidate of candidates) {
            const match = findFirstSearchMatch(candidate, terms)
            if (match) {
                return { text: buildSnippetAroundMatch(candidate, match), terms }
            }
        }
    }

    return {
        text: truncateSnippet(candidates[0] ?? '', HISTORY_SNIPPET_FALLBACK_LENGTH),
        terms: []
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isHighlightedSnippetPart(value: string, terms: string[]): boolean {
    const lowerValue = value.toLocaleLowerCase()
    return terms.some((term) => lowerValue === term)
}

function renderHighlightedSnippet(text: string, terms: string[]) {
    if (terms.length === 0) return text

    const pattern = terms
        .slice()
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')
    const matcher = new RegExp(`(${pattern})`, 'ig')

    return text.split(matcher).map((part, index) => {
        if (!part) return null
        if (!isHighlightedSnippetPart(part, terms)) return <Fragment key={`${part}-${index}`}>{part}</Fragment>
        return (
            <mark key={`${part}-${index}`} className="rounded bg-yellow-200/80 px-0.5 text-[var(--app-fg)] dark:bg-yellow-500/25">
                {part}
            </mark>
        )
    })
}

function formatHistoryTime(value: number): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(value))
    } catch {
        return new Date(value).toLocaleString()
    }
}

function formatHistoryDetailTime(value: number): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(new Date(value))
    } catch {
        return new Date(value).toLocaleString()
    }
}

function buildHistoryCopyText(entry: ConversationHistoryEntry, projectLabel: string | null, t: (key: string) => string): string {
    return [
        `${t('session.history.detail.title')}: ${entry.title}`,
        `${t('session.history.detail.time')}: ${formatHistoryDetailTime(entry.createdAt)}`,
        projectLabel ? `${t('session.history.detail.project')}: ${projectLabel}` : null,
        `${t('session.history.column.tag')}: ${entry.markerColor ? t(`session.marker.${entry.markerColor}`) : '—'}`,
        entry.projectPath ? `${t('session.history.detail.path')}: ${entry.projectPath}` : null,
        '',
        `${t('session.history.detail.user')}:`,
        entry.userText || '—',
        '',
        `${t('session.history.detail.assistant')}:`,
        entry.assistantExcerpt || '—'
    ].filter((item): item is string => item !== null).join('\n')
}

function ConversationHistoryDetailDialog(props: {
    entry: ConversationHistoryEntry | null
    onOpenChange: (open: boolean) => void
}) {
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const entry = props.entry
    const projectLabel = entry ? getProjectLabel(entry) : null
    const copyText = entry ? buildHistoryCopyText(entry, projectLabel, t) : ''

    return (
        <Dialog open={entry !== null} onOpenChange={props.onOpenChange}>
            <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden p-0">
                {entry ? (
                    <>
                        <DialogHeader className="border-b border-[var(--app-border)] px-4 py-3 pr-12">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <DialogTitle className="truncate text-left text-[var(--app-fg)]">{entry.title}</DialogTitle>
                                    <DialogDescription asChild>
                                        <div className="mt-1 space-y-1 text-left text-xs text-[var(--app-hint)]">
                                            <div>{formatHistoryDetailTime(entry.createdAt)}</div>
                                            {projectLabel ? <div>{t('session.history.detail.project')}: {projectLabel}</div> : null}
                                            <div className="inline-flex items-center gap-1.5">
                                                {t('session.history.column.tag')}:
                                                {entry.markerColor ? (
                                                    <>
                                                        <SessionMarkerDot markerColor={entry.markerColor} size={9} />
                                                        {t(`session.marker.${entry.markerColor}`)}
                                                    </>
                                                ) : '—'}
                                            </div>
                                            {entry.projectPath ? <div className="truncate font-mono" title={entry.projectPath}>{entry.projectPath}</div> : null}
                                        </div>
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copy(copyText)}
                                    className="shrink-0 rounded-full border border-[var(--app-border)] px-3 py-1.5 text-xs font-medium text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                >
                                    {copied ? t('session.history.detail.copied') : t('session.history.detail.copy')}
                                </button>
                            </div>
                        </DialogHeader>
                        <button
                            type="button"
                            onClick={() => props.onOpenChange(false)}
                            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('button.close')}
                        >
                            <CloseIcon className="h-4 w-4" />
                        </button>
                        <div className="app-scroll-y min-h-0 flex-1 space-y-4 p-4">
                            <CodeBlock
                                code={entry.userText || '—'}
                                language="text"
                                title={t('session.history.detail.user')}
                                scrollY
                                maxHeight={260}
                            />
                            <CodeBlock
                                code={entry.assistantExcerpt || '—'}
                                language="text"
                                title={t('session.history.detail.assistant')}
                                scrollY
                                maxHeight={420}
                            />
                        </div>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

export function ConversationHistoryPanel(props: {
    api: ApiClient
    session: Session
    open: boolean
    onClose: () => void
    onOpenSession?: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const [scope, setScope] = useState<ConversationHistoryScope>('session')
    const [queryInput, setQueryInput] = useState('')
    const [query, setQuery] = useState('')
    const [userOnly, setUserOnly] = useState(false)
    const [selectedEntry, setSelectedEntry] = useState<ConversationHistoryEntry | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const projectPath = props.session.metadata?.path ?? null

    useEffect(() => {
        if (!props.open) {
            setSelectedEntry(null)
            return
        }
        setScope('session')
    }, [props.open, props.session.id])

    useEffect(() => {
        if (!props.open) return
        const timer = window.setTimeout(() => setQuery(queryInput), 250)
        return () => window.clearTimeout(timer)
    }, [props.open, queryInput])

    const history = useConversationHistory({
        api: props.api,
        open: props.open,
        scope,
        sessionId: props.session.id,
        projectPath,
        query,
        userOnly
    })

    const scopeOptions = useMemo<Array<{ value: ConversationHistoryScope; label: string; disabled?: boolean }>>(() => [
        { value: 'session', label: t('session.history.scope.session') },
        { value: 'project', label: t('session.history.scope.project'), disabled: !projectPath },
        { value: 'all', label: t('session.history.scope.all') }
    ], [projectPath, t])

    const handleScroll = () => {
        const el = scrollRef.current
        if (!el || !history.hasMore || history.isLoadingMore) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
            void history.loadMore()
        }
    }

    if (!props.open) return null

    return (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={(event) => {
            if (event.target === event.currentTarget) props.onClose()
        }}>
            <section className="flex h-full w-full max-w-3xl flex-col border-l border-[var(--app-border)] bg-[var(--app-bg)] shadow-2xl sm:w-[min(760px,92vw)]">
                <header className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
                    <div>
                        <div className="text-sm font-semibold text-[var(--app-fg)]">{t('session.history.title')}</div>
                        <div className="mt-0.5 text-xs text-[var(--app-hint)]">{t('session.history.subtitle')}</div>
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('button.close')}
                    >
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </header>

                <div className="space-y-3 border-b border-[var(--app-border)] p-4">
                    <input
                        type="search"
                        value={queryInput}
                        onChange={(event) => setQueryInput(event.target.value)}
                        placeholder={t('session.history.searchPlaceholder')}
                        className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)]"
                    />
                    <div className="flex flex-wrap gap-2">
                        {scopeOptions.map((item) => {
                            const selected = scope === item.value
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    disabled={item.disabled}
                                    onClick={() => setScope(item.value)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]' : 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                >
                                    {item.label}
                                </button>
                            )
                        })}
                        <button
                            type="button"
                            onClick={() => setUserOnly((value) => !value)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${userOnly ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]' : 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                        >
                            {t('session.history.filter.userOnly')}
                        </button>
                    </div>
                </div>

                <div ref={scrollRef} onScroll={handleScroll} className="app-scroll-y min-h-0 flex-1 p-4">
                    {history.error ? (
                        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                            {history.error}
                        </div>
                    ) : null}

                    {history.isLoading ? (
                        <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('loading')}</div>
                    ) : history.entries.length === 0 ? (
                        <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('session.history.empty')}</div>
                    ) : (
                        <div className="overflow-hidden rounded-xl border border-[var(--app-border)]">
                            <table className="w-full table-fixed border-collapse text-sm">
                                <thead className="bg-[var(--app-secondary-bg)] text-xs text-[var(--app-hint)]">
                                    <tr>
                                        <th className="px-4 py-2 text-left font-medium">{t('session.history.column.content')}</th>
                                        <th className="w-44 px-4 py-2 text-right font-medium sm:w-52">{t('session.history.column.meta')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--app-border)]">
                                    {history.entries.map((entry) => {
                                        const projectLabel = getProjectLabel(entry)
                                        const snippet = getHistorySnippet(entry, query)
                                        return (
                                            <tr
                                                key={entry.id}
                                                className="cursor-pointer align-top hover:bg-[var(--app-subtle-bg)]"
                                                onClick={() => setSelectedEntry(entry)}
                                            >
                                                <td className="px-4 py-8">
                                                    <div className="flex min-h-36 flex-col">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                setSelectedEntry(entry)
                                                            }}
                                                            className="line-clamp-2 text-left text-sm font-medium leading-5 text-[var(--app-link)] hover:underline"
                                                            title={entry.projectPath ?? entry.title}
                                                        >
                                                            {entry.title}
                                                        </button>
                                                        {snippet.text ? (
                                                            <div className="mt-3 line-clamp-6 text-left text-xs leading-5 text-[var(--app-hint)]">
                                                                {renderHighlightedSnippet(snippet.text, snippet.terms)}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-8 text-right text-xs text-[var(--app-hint)]">
                                                    <div className="flex min-h-36 flex-col items-end gap-3">
                                                        <div className="whitespace-nowrap">{formatHistoryTime(entry.createdAt)}</div>
                                                        <div>
                                                            {entry.markerColor ? (
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <SessionMarkerDot markerColor={entry.markerColor} size={9} />
                                                                    {t(`session.marker.${entry.markerColor}`)}
                                                                </span>
                                                            ) : '—'}
                                                        </div>
                                                        {projectLabel ? (
                                                            <div className="max-w-full truncate text-[11px]" title={entry.projectPath ?? projectLabel}>
                                                                {projectLabel}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {history.hasMore ? (
                        <div className="flex justify-center py-4">
                            <button
                                type="button"
                                onClick={() => void history.loadMore()}
                                disabled={history.isLoadingMore}
                                className="rounded-full border border-[var(--app-border)] px-4 py-2 text-sm text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {history.isLoadingMore ? t('session.history.loadingMore') : t('session.history.loadMore')}
                            </button>
                        </div>
                    ) : null}
                </div>
            </section>
            <ConversationHistoryDetailDialog
                entry={selectedEntry}
                onOpenChange={(open) => {
                    if (!open) setSelectedEntry(null)
                }}
            />
        </div>
    )
}
