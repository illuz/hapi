import type { MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import type { ReactElement, ReactNode, ComponentPropsWithoutRef } from 'react'
import { createContext, isValidElement, useContext } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_REHYPE_PLUGINS,
    MARKDOWN_COMPONENTS_BY_LANGUAGE,
    MARKDOWN_CLASSNAME,
} from '@/components/assistant-ui/markdown-text'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
    content: string
    components?: MarkdownTextPrimitiveProps['components']
    className?: string
}

const StaticPreContext = createContext<ComponentPropsWithoutRef<'pre'> | null>(null)

function getTextFromReactNode(value: ReactNode): string {
    if (value === null || value === undefined || typeof value === 'boolean') return ''
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (Array.isArray(value)) return value.map(getTextFromReactNode).join('')
    if (isValidElement(value)) {
        return getTextFromReactNode((value as ReactElement<{ children?: ReactNode }>).props.children)
    }
    return ''
}

function resolveCodeLanguage(className: string | undefined): string {
    return /language-([\w-]+)/.exec(className ?? '')?.[1] ?? ''
}

function StaticCodeHeader(props: { language: string; code: string }) {
    const { copied, copy } = useCopyToClipboard()
    const language = props.language || 'text'

    return (
        <div className="aui-code-shell-header flex items-center justify-between gap-3 rounded-t-xl bg-[var(--app-code-header-bg)] px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-[var(--app-code-header-fg)]">
            <div className="min-w-0 flex-1 truncate font-mono">
                {language}
            </div>
            <button
                type="button"
                onClick={() => copy(props.code)}
                className="shrink-0 rounded-md p-1 text-[var(--app-code-header-fg)] transition-colors hover:bg-[var(--app-code-copy-hover-bg)] hover:text-[var(--app-fg)]"
                title="Copy"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

function StaticPre(props: ComponentPropsWithoutRef<'pre'>) {
    const { children, ...rest } = props
    return (
        <StaticPreContext.Provider value={rest}>
            {children}
        </StaticPreContext.Provider>
    )
}

function StaticCode(props: ComponentPropsWithoutRef<'code'>) {
    const preProps = useContext(StaticPreContext)
    const { className, children, ...rest } = props

    if (!preProps) {
        return (
            <code
                {...rest}
                className={cn(
                    'aui-md-code break-words rounded-md border border-[var(--app-inline-code-border)] bg-[var(--app-inline-code-bg)] px-[0.38em] py-[0.14em] font-mono text-[0.88em] text-[var(--app-inline-code-fg)]',
                    className
                )}
            >
                {children}
            </code>
        )
    }

    const code = getTextFromReactNode(children).replace(/\n$/, '')
    const language = resolveCodeLanguage(className)
    const componentsByLanguage = MARKDOWN_COMPONENTS_BY_LANGUAGE as Record<
        string,
        { SyntaxHighlighter?: typeof SyntaxHighlighter }
    >
    const LanguageSyntaxHighlighter = componentsByLanguage[language]?.SyntaxHighlighter ?? SyntaxHighlighter

    return (
        <>
            <StaticCodeHeader language={language || 'text'} code={code} />
            <LanguageSyntaxHighlighter
                language={language || 'text'}
                code={code}
                components={{
                    Pre: StaticPre,
                    Code: StaticCode,
                }}
            />
        </>
    )
}

function A(props: ComponentPropsWithoutRef<'a'>) {
    const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel

    return (
        <a
            {...props}
            rel={rel}
            className={cn('aui-md-a font-medium text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3', props.className)}
        />
    )
}

function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
    return <p {...props} className={cn('aui-md-p my-2.5 leading-7 first:mt-0 last:mb-0', props.className)} />
}

function Blockquote(props: ComponentPropsWithoutRef<'blockquote'>) {
    return (
        <blockquote
            {...props}
            className={cn(
                'aui-md-blockquote my-3 rounded-r-2xl border-l-[3px] border-[var(--app-md-quote-border)] bg-[var(--app-md-quote-bg)] px-4 py-3 text-[var(--app-md-quote-fg)]',
                props.className
            )}
        />
    )
}

function UnorderedList(props: ComponentPropsWithoutRef<'ul'>) {
    return <ul {...props} className={cn('aui-md-ul my-2.5 list-disc pl-6 marker:text-[var(--app-hint)] [&>li]:mt-1.5', props.className)} />
}

function OrderedList(props: ComponentPropsWithoutRef<'ol'>) {
    return <ol {...props} className={cn('aui-md-ol my-2.5 list-decimal pl-6 marker:text-[var(--app-hint)] [&>li]:mt-1.5', props.className)} />
}

function ListItem(props: ComponentPropsWithoutRef<'li'>) {
    return <li {...props} className={cn('aui-md-li leading-7', props.className)} />
}

function Hr(props: ComponentPropsWithoutRef<'hr'>) {
    return <hr {...props} className={cn('aui-md-hr my-4 border-[var(--app-divider)]', props.className)} />
}

function Table(props: ComponentPropsWithoutRef<'table'>) {
    const { className, ...rest } = props

    return (
        <div className="aui-md-table-wrapper my-3 max-w-full overflow-x-auto rounded-xl bg-[var(--app-md-table-bg)]">
            <table {...rest} className={cn('aui-md-table w-full border-collapse text-sm', className)} />
        </div>
    )
}

function Thead(props: ComponentPropsWithoutRef<'thead'>) {
    return <thead {...props} className={cn('aui-md-thead bg-[var(--app-md-table-head-bg)]', props.className)} />
}

function Tbody(props: ComponentPropsWithoutRef<'tbody'>) {
    return <tbody {...props} className={cn('aui-md-tbody', props.className)} />
}

function Tr(props: ComponentPropsWithoutRef<'tr'>) {
    return <tr {...props} className={cn('aui-md-tr border-t border-[var(--app-divider)] first:border-t-0', props.className)} />
}

function Th(props: ComponentPropsWithoutRef<'th'>) {
    return (
        <th
            {...props}
            className={cn(
                'aui-md-th px-3 py-2 text-left font-semibold text-[var(--app-fg)] [[align=center]]:text-center [[align=right]]:text-right',
                props.className
            )}
        />
    )
}

function Td(props: ComponentPropsWithoutRef<'td'>) {
    return <td {...props} className={cn('aui-md-td px-3 py-2 align-top text-[var(--app-fg)] [[align=center]]:text-center [[align=right]]:text-right', props.className)} />
}

function H1(props: ComponentPropsWithoutRef<'h1'>) {
    return <h1 {...props} className={cn('aui-md-h1 mt-4 text-[1.05rem] font-semibold tracking-[-0.01em] first:mt-0', props.className)} />
}

function H2(props: ComponentPropsWithoutRef<'h2'>) {
    return <h2 {...props} className={cn('aui-md-h2 mt-4 text-base font-semibold tracking-[-0.01em] first:mt-0', props.className)} />
}

function H3(props: ComponentPropsWithoutRef<'h3'>) {
    return <h3 {...props} className={cn('aui-md-h3 mt-3 text-[0.95rem] font-semibold first:mt-0', props.className)} />
}

function H4(props: ComponentPropsWithoutRef<'h4'>) {
    return <h4 {...props} className={cn('aui-md-h4 mt-3 text-[0.92rem] font-semibold first:mt-0', props.className)} />
}

function H5(props: ComponentPropsWithoutRef<'h5'>) {
    return <h5 {...props} className={cn('aui-md-h5 mt-2.5 text-[0.9rem] font-semibold first:mt-0', props.className)} />
}

function H6(props: ComponentPropsWithoutRef<'h6'>) {
    return <h6 {...props} className={cn('aui-md-h6 mt-2.5 text-[0.88rem] font-semibold first:mt-0', props.className)} />
}

function Strong(props: ComponentPropsWithoutRef<'strong'>) {
    return <strong {...props} className={cn('aui-md-strong font-semibold text-[var(--app-fg)]', props.className)} />
}

function Em(props: ComponentPropsWithoutRef<'em'>) {
    return <em {...props} className={cn('aui-md-em italic', props.className)} />
}

function Image(props: ComponentPropsWithoutRef<'img'>) {
    return <img {...props} className={cn('aui-md-img my-3 max-w-full rounded-xl', props.className)} />
}

const staticComponents = {
    pre: StaticPre,
    code: StaticCode,
    h1: H1,
    h2: H2,
    h3: H3,
    h4: H4,
    h5: H5,
    h6: H6,
    a: A,
    p: Paragraph,
    strong: Strong,
    em: Em,
    blockquote: Blockquote,
    ul: UnorderedList,
    ol: OrderedList,
    li: ListItem,
    hr: Hr,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
    img: Image,
} satisfies Components

function MarkdownContent(props: MarkdownRendererProps) {
    const extraComponents = props.components as Components | undefined
    const mergedComponents = props.components
        ? { ...staticComponents, ...extraComponents }
        : staticComponents

    return (
        <div className={cn(MARKDOWN_CLASSNAME, props.className)}>
            <ReactMarkdown
                remarkPlugins={MARKDOWN_PLUGINS}
                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                components={mergedComponents}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
    return <MarkdownContent {...props} />
}
