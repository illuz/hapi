import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { defaultUrlTransform, type UrlTransform } from 'react-markdown'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { resolveLocalFileHref } from '@/lib/filePathLinks'
import { I18nContext } from '@/lib/i18n-context'
import { cn } from '@/lib/utils'

export type MarkdownLinkBehavior = 'navigate' | 'copy-non-file'

const SESSION_FILE_PATH_PATTERN = /^\/sessions\/[^/?#]+\/file$/
const EXPLICIT_ORIGIN_PATTERN = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i
const MarkdownLinkBehaviorContext = createContext<{
    behavior: MarkdownLinkBehavior
    sessionId?: string
    workingDirectory?: string | null
}>({ behavior: 'navigate' })

export function MarkdownLinkBehaviorProvider(props: {
    behavior: MarkdownLinkBehavior
    sessionId?: string
    workingDirectory?: string | null
    children: ReactNode
}) {
    const value = useMemo(() => ({
        behavior: props.behavior,
        sessionId: props.sessionId,
        workingDirectory: props.workingDirectory,
    }), [props.behavior, props.sessionId, props.workingDirectory])

    return (
        <MarkdownLinkBehaviorContext.Provider value={value}>
            {props.children}
        </MarkdownLinkBehaviorContext.Provider>
    )
}

export function isSessionFileHref(href: string | undefined): boolean {
    if (!href) return false

    try {
        const baseHref = typeof window !== 'undefined' ? window.location.href : 'https://hapi.local'
        const url = new URL(href, baseHref)
        if (EXPLICIT_ORIGIN_PATTERN.test(href) && url.origin !== new URL(baseHref).origin) {
            return false
        }
        return SESSION_FILE_PATH_PATTERN.test(url.pathname) && url.searchParams.has('path')
    } catch {
        return false
    }
}

export function useMarkdownLinkUrlTransform(): UrlTransform {
    const { behavior, sessionId, workingDirectory } = useContext(MarkdownLinkBehaviorContext)

    return useCallback<UrlTransform>((url, key) => {
        if (key === 'href' && behavior === 'copy-non-file' && !isSessionFileHref(url)) {
            const localFileHref = resolveLocalFileHref(url, sessionId, workingDirectory)
            if (localFileHref) return localFileHref
        }
        return defaultUrlTransform(url)
    }, [behavior, sessionId, workingDirectory])
}

function shouldCopyMarkdownHref(href: string | undefined, behavior: MarkdownLinkBehavior): href is string {
    return behavior === 'copy-non-file' && Boolean(href) && !isSessionFileHref(href)
}

export function MarkdownAnchor(props: ComponentPropsWithoutRef<'a'>) {
    const { className, href, onClick, rel: relProp, target, title, ...rest } = props
    const { behavior } = useContext(MarkdownLinkBehaviorContext)
    const i18n = useContext(I18nContext)
    const { copied, copy } = useCopyToClipboard()
    const resolvedTarget = isSessionFileHref(href) ? undefined : target
    const shouldCopy = shouldCopyMarkdownHref(href, behavior)
    const rel = resolvedTarget === '_blank' ? (relProp ?? 'noreferrer') : relProp
    const copyTitle = i18n?.t('markdown.copyLink') ?? 'Copy link'
    const copiedLabel = i18n?.t('markdown.linkCopied') ?? 'Copied'

    const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented || !shouldCopy) return

        event.preventDefault()
        event.stopPropagation()
        void copy(href)
    }, [copy, href, onClick, shouldCopy])

    const link = (
        <a
            {...rest}
            href={href}
            target={resolvedTarget}
            rel={rel}
            title={title ?? (shouldCopy ? copyTitle : undefined)}
            onClick={handleClick}
            className={cn('aui-md-a font-medium text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3', className)}
        />
    )

    if (!shouldCopy) return link

    return (
        <span className="relative inline-flex align-baseline">
            {link}
            {copied ? (
                <span
                    role="status"
                    className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--app-fg)] px-2 py-1 text-[11px] font-medium leading-none text-[var(--app-bg)] shadow-lg"
                >
                    {copiedLabel}
                </span>
            ) : null}
        </span>
    )
}
