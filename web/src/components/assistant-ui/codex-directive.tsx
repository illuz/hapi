import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CodexDirective } from '@/lib/codexDirectives'
import { resolveLocalFileHref } from '@/lib/filePathLinks'
import { I18nContext, type Translations } from '@/lib/i18n-context'
import en from '@/lib/locales/en'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

const CodexFollowupContext = createContext<((prompt: string) => void) | undefined>(undefined)

export function CodexFollowupProvider(props: {
    onInsertPrompt?: (prompt: string) => void
    children: ReactNode
}) {
    return (
        <CodexFollowupContext.Provider value={props.onInsertPrompt}>
            {props.children}
        </CodexFollowupContext.Provider>
    )
}

export function CodexDirectiveView(props: {
    directive: CodexDirective
    sessionId?: string
    workingDirectory?: string | null
}) {
    const { directive, sessionId, workingDirectory } = props
    const { attributes: attrs, name } = directive
    const onInsertPrompt = useContext(CodexFollowupContext)
    const i18n = useContext(I18nContext)
    const t = (key: string) => i18n?.t(key) ?? (en as Translations)[key] ?? key
    const [inserted, setInserted] = useState(false)
    const { copied, copy } = useCopyToClipboard()

    if (name === 'writing') {
        return (
            <span className="my-2 inline-flex w-full flex-col gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3">
                <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{attrs.title ?? attrs.subject ?? t('codexDirective.writing')}</span>
                    <button
                        type="button"
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]"
                        onClick={(event) => {
                            event.stopPropagation()
                            void copy(directive.body ?? '')
                        }}
                    >
                        {copied ? t('markdown.linkCopied') : t('codexDirective.copy')}
                    </button>
                </span>
                <span className="whitespace-pre-wrap break-words">{directive.body}</span>
            </span>
        )
    }

    if (name === 'codex-followup') {
        return (
            <span className="inline-flex max-w-full flex-col items-start gap-1 align-middle">
                <button
                    type="button"
                    disabled={!onInsertPrompt}
                    title={attrs.prompt}
                    onClick={(event) => {
                        event.stopPropagation()
                        if (!onInsertPrompt) return
                        onInsertPrompt(attrs.prompt)
                        setInserted(true)
                    }}
                    className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-1 text-left text-sm font-medium text-[var(--app-link)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-default disabled:opacity-60"
                >
                    {directive.label}
                </button>
                <span className="whitespace-pre-wrap text-xs text-[var(--app-hint)]">
                    {attrs.prompt}
                </span>
                {inserted ? <span role="status" className="text-xs text-[var(--app-hint)]">{t('codexDirective.inserted')}</span> : null}
            </span>
        )
    }

    const isComment = name === 'code-comment'
    const isInbox = name === 'inbox-item'
    const file = isComment ? attrs.file : name === 'codex-inline-vis' || name === 'codex-live-vis'
        ? attrs.file ?? attrs.path
        : undefined
    const href = file ? resolveLocalFileHref(file, sessionId, workingDirectory) : null
    const line = isComment && /^\d+$/.test(attrs.start ?? '') ? ':' + attrs.start : ''
    const location = file ? file + line + (line && /^\d+$/.test(attrs.end ?? '') ? '–' + attrs.end : '') : ''
    const title = attrs.title ?? attrs.name ?? directive.label ?? t('codexDirective.' + name)
    const body = isComment ? attrs.body : isInbox ? attrs.summary : undefined
    const priority = isComment && /^(?:P)?[0-3]$/.test(attrs.priority ?? '')
        ? attrs.priority.replace(/^P?/, 'P')
        : undefined
    const fields = isComment || isInbox ? [] : Object.entries(attrs)
        .filter(([key]) => !['title', 'name'].includes(key))

    return (
        <span className="my-1 inline-flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3 align-top text-sm">
            <span className="flex flex-wrap items-center gap-2 font-semibold">
                {priority ? <span className="rounded border border-[var(--app-border)] px-1.5 text-xs">{priority}</span> : null}
                <span>{title}</span>
            </span>
            {!isComment && !isInbox && title !== t('codexDirective.' + name)
                ? <span className="text-xs text-[var(--app-hint)]">{t('codexDirective.' + name)}</span>
                : null}
            {body ? <span className="whitespace-pre-wrap break-words">{body}</span> : null}
            {file ? (
                href
                    ? <a href={href} className="break-all font-mono text-xs text-[var(--app-link)] underline">{location}</a>
                    : <span className="break-all font-mono text-xs">{location}</span>
            ) : null}
            {fields.map(([key, value]) => (
                <span key={key} className="whitespace-pre-wrap break-words text-xs">
                    <span className="text-[var(--app-hint)]">{key}: </span>{value}
                </span>
            ))}
            {!isComment && !isInbox ? (
                <span className="text-xs text-[var(--app-hint)]">{t('codexDirective.previewOnly')}</span>
            ) : null}
        </span>
    )
}
