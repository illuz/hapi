import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import type { GitCommandResponse } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'
import { cn, decodeBase64 } from '@/lib/utils'

const MAX_COPYABLE_FILE_BYTES = 1_000_000
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx'])
const IMAGE_MIME_TYPES = new Map<string, string>([
    ['apng', 'image/apng'],
    ['avif', 'image/avif'],
    ['bmp', 'image/bmp'],
    ['gif', 'image/gif'],
    ['ico', 'image/x-icon'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['svg', 'image/svg+xml'],
    ['webp', 'image/webp'],
])

type FileDisplayMode = 'diff' | 'source' | 'rendered' | 'image'

function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function DiffDisplay(props: { diffContent: string }) {
    const lines = props.diffContent.split('\n')

    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            {lines.map((line, index) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isRemove = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                const isHeader = line.startsWith('+++') || line.startsWith('---')

                const className = [
                    'whitespace-pre-wrap px-3 py-0.5 text-xs font-mono',
                    isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
                    isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
                    isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
                    isHeader ? 'text-[var(--app-hint)] font-semibold' : ''
                ].filter(Boolean).join(' ')

                const style = isAdd
                    ? { borderLeft: '2px solid var(--app-git-staged-color)' }
                    : isRemove
                        ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                        : undefined

                return (
                    <div key={`${index}-${line}`} className={className} style={style}>
                        {line || ' '}
                    </div>
                )
            })}
        </div>
    )
}

function FileContentSkeleton() {
    const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4', 'w-2/3', 'w-4/5']

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">Loading file…</span>
            <div className="animate-pulse space-y-2 rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3">
                {Array.from({ length: 12 }).map((_, index) => (
                    <div key={`file-skeleton-${index}`} className={`h-3 ${widths[index % widths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                ))}
            </div>
        </div>
    )
}

function getFileExtension(path: string): string {
    const fileName = path.split('/').pop() ?? path
    const parts = fileName.split('.')
    if (parts.length <= 1) return ''
    return parts[parts.length - 1]?.toLowerCase() ?? ''
}

export function isMarkdownFilePath(path: string): boolean {
    return MARKDOWN_EXTENSIONS.has(getFileExtension(path))
}

export function isPreviewableImageFilePath(path: string): boolean {
    return IMAGE_MIME_TYPES.has(getFileExtension(path))
}

function getImageMimeType(path: string): string | null {
    return IMAGE_MIME_TYPES.get(getFileExtension(path)) ?? null
}

function resolveLanguage(path: string): string | undefined {
    const ext = getFileExtension(path)
    if (!ext) return undefined
    if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
    return langAlias[ext] ?? ext
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

function DiffUnavailableNotice(props: { message: string }) {
    return (
        <details
            data-testid="diff-unavailable-notice"
            className="group mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 text-xs text-[var(--app-hint)]"
        >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-2 transition-colors hover:text-[var(--app-fg)] [&::-webkit-details-marker]:hidden">
                <span>Diff unavailable</span>
                <span className="shrink-0 text-[11px] text-[var(--app-hint)] group-open:hidden">Show details</span>
                <span className="hidden shrink-0 text-[11px] text-[var(--app-hint)] group-open:inline">Hide details</span>
            </summary>
            <div className="border-t border-amber-500/20 px-2 py-2 font-mono text-[11px] leading-relaxed">
                {props.message}
            </div>
        </details>
    )
}

function FileModeButton(props: {
    active: boolean
    children: string
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={cn(
                'rounded px-3 py-1 text-xs font-semibold transition-colors',
                props.active
                    ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80'
                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]'
            )}
        >
            {props.children}
        </button>
    )
}

function CopyContentButton(props: {
    canCopy: boolean
    copied: boolean
    onCopy: () => void
}) {
    if (!props.canCopy) return null

    return (
        <button
            type="button"
            onClick={props.onCopy}
            className="absolute right-2 top-2 z-10 rounded p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
            title="Copy file content"
        >
            {props.copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        </button>
    )
}

function SourcePreview(props: {
    content: string
    highlighted: ReactNode | null
    canCopy: boolean
    copied: boolean
    onCopy: () => void
}) {
    return (
        <div className="relative">
            <CopyContentButton
                canCopy={props.canCopy}
                copied={props.copied}
                onCopy={props.onCopy}
            />
            <pre className="shiki overflow-auto rounded-md bg-[var(--app-code-bg)] p-3 pr-8 text-xs font-mono">
                <code>{props.highlighted ?? props.content}</code>
            </pre>
        </div>
    )
}

function RenderedMarkdownPreview(props: {
    content: string
    canCopy: boolean
    copied: boolean
    onCopy: () => void
}) {
    return (
        <div className="relative">
            <CopyContentButton
                canCopy={props.canCopy}
                copied={props.copied}
                onCopy={props.onCopy}
            />
            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-4 pr-10">
                <MarkdownRenderer content={props.content} className="text-sm" />
            </div>
        </div>
    )
}

function ImagePreview(props: {
    dataUri: string
    fileName: string
    mimeType: string
}) {
    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            <div className="flex min-h-[220px] items-center justify-center bg-[var(--app-code-bg)] p-3">
                <img
                    src={props.dataUri}
                    alt={props.fileName}
                    loading="lazy"
                    className="max-h-[70vh] max-w-full rounded object-contain"
                />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)]">
                <span className="min-w-0 truncate">{props.mimeType}</span>
                <a
                    href={props.dataUri}
                    target="_blank"
                    rel="noreferrer"
                    download={props.fileName}
                    className="shrink-0 rounded px-2 py-1 font-semibold text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                >
                    Open image
                </a>
            </div>
        </div>
    )
}

function getEffectiveDisplayMode(mode: FileDisplayMode, hasDiff: boolean, markdownFile: boolean, imageFile: boolean): FileDisplayMode {
    if (mode === 'diff' && hasDiff) return 'diff'
    if (mode === 'rendered' && markdownFile) return 'rendered'
    if (mode === 'image' && imageFile) return 'image'
    if (mode === 'source' && !imageFile) return 'source'
    if (imageFile) return 'image'
    return markdownFile ? 'rendered' : 'source'
}

export default function FilePage() {
    const { api } = useAppContext()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const { copied: contentCopied, copy: copyContent } = useCopyToClipboard()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/file' })
    const search = useSearch({ from: '/sessions/$sessionId/file' })
    const encodedPath = typeof search.path === 'string' ? search.path : ''
    const staged = search.staged

    const filePath = useMemo(() => decodePath(encodedPath), [encodedPath])
    const fileName = filePath.split('/').pop() || filePath || 'File'

    const diffQuery = useQuery({
        queryKey: queryKeys.gitFileDiff(sessionId, filePath, staged),
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.getGitDiffFile(sessionId, filePath, staged)
        },
        enabled: Boolean(api && sessionId && filePath)
    })

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(sessionId, filePath),
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.readSessionFile(sessionId, filePath)
        },
        enabled: Boolean(api && sessionId && filePath)
    })

    const diffContent = diffQuery.data?.success ? (diffQuery.data.stdout ?? '') : ''
    const diffError = extractCommandError(diffQuery.data)
    const diffSuccess = diffQuery.data?.success === true
    const diffFailed = diffQuery.data?.success === false

    const markdownFile = useMemo(() => isMarkdownFilePath(filePath), [filePath])
    const imageFile = useMemo(() => isPreviewableImageFilePath(filePath), [filePath])
    const imageMimeType = useMemo(() => getImageMimeType(filePath), [filePath])

    const fileContentResult = fileQuery.data
    const encodedContent = fileContentResult?.success ? (fileContentResult.content ?? '') : ''
    const decodedContentResult = fileContentResult?.success && encodedContent && !imageFile
        ? decodeBase64(encodedContent)
        : { text: '', ok: true }
    const decodedContent = decodedContentResult.text
    const binaryFile = fileContentResult?.success
        ? !imageFile && (!decodedContentResult.ok || isBinaryContent(decodedContent))
        : false
    const imageDataUri = fileContentResult?.success && encodedContent && imageMimeType
        ? `data:${imageMimeType};base64,${encodedContent}`
        : null

    const language = useMemo(() => imageFile ? undefined : resolveLanguage(filePath), [filePath, imageFile])
    const highlighted = useShikiHighlighter(imageFile ? '' : decodedContent, language)
    const contentSizeBytes = useMemo(
        () => (decodedContent ? getUtf8ByteLength(decodedContent) : 0),
        [decodedContent]
    )
    const canCopyContent = fileContentResult?.success === true
        && !binaryFile
        && decodedContent.length > 0
        && contentSizeBytes <= MAX_COPYABLE_FILE_BYTES

    const [displayMode, setDisplayMode] = useState<FileDisplayMode>('diff')

    useEffect(() => {
        setDisplayMode(imageFile ? 'image' : 'diff')
    }, [filePath, staged, imageFile])

    useEffect(() => {
        if (diffSuccess && !diffContent) {
            setDisplayMode(imageFile ? 'image' : markdownFile ? 'rendered' : 'source')
            return
        }
        if (diffFailed) {
            setDisplayMode(imageFile ? 'image' : markdownFile ? 'rendered' : 'source')
        }
    }, [diffSuccess, diffFailed, diffContent, markdownFile, imageFile])

    useEffect(() => {
        if (!markdownFile && displayMode === 'rendered') {
            setDisplayMode(imageFile ? 'image' : diffContent ? 'diff' : 'source')
            return
        }
        if (!imageFile && displayMode === 'image') {
            setDisplayMode(diffContent ? 'diff' : markdownFile ? 'rendered' : 'source')
        }
    }, [markdownFile, imageFile, displayMode, diffContent])

    const loading = diffQuery.isLoading || fileQuery.isLoading
    const fileError = fileContentResult && !fileContentResult.success
        ? (fileContentResult.error ?? 'Failed to read file')
        : null
    const missingPath = !filePath
    const effectiveDisplayMode = getEffectiveDisplayMode(displayMode, Boolean(diffContent), markdownFile, imageFile)
    const showModeSwitcher = Boolean(diffContent) || markdownFile

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{fileName}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{filePath || 'Unknown path'}</div>
                    </div>
                </div>
            </div>

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                    <FileIcon fileName={fileName} size={20} />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">{filePath}</span>
                    <button
                        type="button"
                        onClick={() => copyPath(filePath)}
                        className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        title="Copy path"
                    >
                        {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {showModeSwitcher ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                        {diffContent ? (
                            <FileModeButton
                                active={effectiveDisplayMode === 'diff'}
                                onClick={() => setDisplayMode('diff')}
                            >
                                Diff
                            </FileModeButton>
                        ) : null}
                        {!imageFile ? (
                            <FileModeButton
                                active={effectiveDisplayMode === 'source'}
                                onClick={() => setDisplayMode('source')}
                            >
                                {markdownFile ? 'Source' : 'File'}
                            </FileModeButton>
                        ) : null}
                        {markdownFile ? (
                            <FileModeButton
                                active={effectiveDisplayMode === 'rendered'}
                                onClick={() => setDisplayMode('rendered')}
                            >
                                Rendered
                            </FileModeButton>
                        ) : null}
                        {imageFile ? (
                            <FileModeButton
                                active={effectiveDisplayMode === 'image'}
                                onClick={() => setDisplayMode('image')}
                            >
                                Preview
                            </FileModeButton>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="app-scroll-y flex-1 min-h-0">
                <div className="mx-auto w-full max-w-content p-4">
                    {diffError ? (
                        <DiffUnavailableNotice message={diffError} />
                    ) : null}
                    {missingPath ? (
                        <div className="text-sm text-[var(--app-hint)]">No file path provided.</div>
                    ) : loading ? (
                        <FileContentSkeleton />
                    ) : fileError ? (
                        <div className="text-sm text-[var(--app-hint)]">{fileError}</div>
                    ) : binaryFile ? (
                        <div className="text-sm text-[var(--app-hint)]">
                            This looks like a binary file. It cannot be displayed.
                        </div>
                    ) : effectiveDisplayMode === 'diff' && diffContent ? (
                        <DiffDisplay diffContent={diffContent} />
                    ) : effectiveDisplayMode === 'diff' && diffError ? (
                        <div className="text-sm text-[var(--app-hint)]">{diffError}</div>
                    ) : effectiveDisplayMode === 'rendered' && markdownFile ? (
                        decodedContent ? (
                            <RenderedMarkdownPreview
                                content={decodedContent}
                                canCopy={canCopyContent}
                                copied={contentCopied}
                                onCopy={() => copyContent(decodedContent)}
                            />
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">File is empty.</div>
                        )
                    ) : effectiveDisplayMode === 'image' && imageFile ? (
                        imageDataUri && imageMimeType ? (
                            <ImagePreview
                                dataUri={imageDataUri}
                                fileName={fileName}
                                mimeType={imageMimeType}
                            />
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">File is empty.</div>
                        )
                    ) : effectiveDisplayMode === 'source' ? (
                        decodedContent ? (
                            <SourcePreview
                                content={decodedContent}
                                highlighted={highlighted}
                                canCopy={canCopyContent}
                                copied={contentCopied}
                                onCopy={() => copyContent(decodedContent)}
                            />
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">File is empty.</div>
                        )
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">No changes to display.</div>
                    )}
                </div>
            </div>
        </div>
    )
}
