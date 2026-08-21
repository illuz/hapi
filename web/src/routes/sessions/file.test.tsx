import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FilePage, { isMarkdownFilePath, isPreviewableImageFilePath } from './file'

const mockState = vi.hoisted(() => ({
    search: {
        path: '',
        staged: undefined as boolean | undefined,
    },
    diffQuery: {
        data: { success: true, stdout: '', error: undefined as string | undefined },
        isLoading: false,
    },
    fileQuery: {
        data: undefined as { success: boolean; content?: string; error?: string } | undefined,
        isLoading: false,
    },
    readSessionFile: vi.fn(),
    copy: vi.fn(),
    goBack: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => mockState.search,
}))

vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: {
        queryKey: readonly unknown[]
        queryFn: () => Promise<unknown>
        enabled: boolean
    }) => {
        const key = options.queryKey[0]
        if (key === 'git-file-diff') return mockState.diffQuery
        if (key === 'session-file') return mockState.fileQuery
        return { data: undefined, isLoading: false }
    },
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            getGitDiffFile: vi.fn(),
            readSessionFile: mockState.readSessionFile,
        },
    }),
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => mockState.goBack,
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: mockState.copy,
    }),
}))

vi.mock('@/lib/shiki', () => ({
    langAlias: {
        ts: 'typescript',
        md: 'markdown',
    },
    useShikiHighlighter: () => null,
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string; className?: string }) => {
        const firstHeading = props.content.match(/^#\s+(.+)$/m)?.[1] ?? props.content
        return (
            <article data-testid="markdown-preview" className={props.className}>
                <h1>{firstHeading}</h1>
            </article>
        )
    },
}))

vi.mock('@/components/FilePreview/DocumentPreview', () => ({
    default: (props: { fileName: string }) => (
        <section role="region" aria-label={`${props.fileName} preview`} />
    ),
}))

vi.mock('@/components/Spinner', () => ({
    Spinner: (props: { label?: string | null }) => (
        <span role={props.label === null ? undefined : 'status'} aria-label={props.label ?? undefined} />
    ),
}))

afterEach(() => {
    cleanup()
})

function encodeBase64(value: string): string {
    return btoa(value)
}

function setFile(path: string, content: string) {
    mockState.search.path = encodeBase64(path)
    mockState.fileQuery = {
        data: { success: true, content: encodeBase64(content) },
        isLoading: false,
    }
}

describe('isMarkdownFilePath', () => {
    it('recognizes common Markdown file extensions', () => {
        expect(isMarkdownFilePath('README.md')).toBe(true)
        expect(isMarkdownFilePath('docs/guide.markdown')).toBe(true)
        expect(isMarkdownFilePath('notes.MDX')).toBe(true)
        expect(isMarkdownFilePath('src/app.ts')).toBe(false)
    })
})

describe('isPreviewableImageFilePath', () => {
    it('recognizes common browser image file extensions', () => {
        expect(isPreviewableImageFilePath('assets/logo.png')).toBe(true)
        expect(isPreviewableImageFilePath('assets/photo.JPG')).toBe(true)
        expect(isPreviewableImageFilePath('assets/diagram.svg')).toBe(true)
        expect(isPreviewableImageFilePath('assets/icon.webp')).toBe(true)
        expect(isPreviewableImageFilePath('archive.zip')).toBe(false)
    })
})

describe('FilePage Markdown preview', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: vi.fn(() => 'blob:hapi-file-download'),
        })
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: vi.fn(),
        })
        mockState.search.staged = undefined
        mockState.diffQuery = {
            data: { success: true, stdout: '', error: undefined },
            isLoading: false,
        }
        setFile('README.md', '# Title\n\nBody')
    })

    it('renders Markdown files by default and toggles back to source', () => {
        render(<FilePage />)

        expect(screen.getByRole('button', { name: 'Source' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument()
        expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
        expect(screen.getByText(/# Title/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Rendered' }))

        expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    })

    it('keeps the existing Diff/File switcher for non-Markdown files with diffs', () => {
        mockState.diffQuery = {
            data: { success: true, stdout: '@@ -1 +1 @@\n+const value = 1', error: undefined },
            isLoading: false,
        }
        setFile('src/app.ts', 'const value = 1')

        render(<FilePage />)

        expect(screen.getByRole('button', { name: 'Diff' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Source' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Rendered' })).not.toBeInTheDocument()
        expect(screen.getByText('+const value = 1')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'File' }))

        expect(screen.getByText('const value = 1')).toBeInTheDocument()
    })

    it('collapses diff errors while still showing the file preview', () => {
        mockState.diffQuery = {
            data: { success: false, stdout: '', error: 'Command failed: not a git repository' },
            isLoading: false,
        }
        setFile('README.md', '# Title\n\nBody')

        render(<FilePage />)

        const notice = screen.getByTestId('diff-unavailable-notice')
        expect(notice).not.toHaveAttribute('open')
        expect(screen.getByText('Diff unavailable')).toBeInTheDocument()
        expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()

        fireEvent.click(screen.getByText('Diff unavailable'))

        expect(notice).toHaveAttribute('open')
        expect(screen.getByText('Command failed: not a git repository')).toBeInTheDocument()
    })

    it('renders image files as a visual preview instead of a binary warning', () => {
        const imageBytes = '\x00\x01binary-image'
        setFile('assets/diagram.png', imageBytes)

        render(<FilePage />)

        const image = screen.getByRole('img', { name: 'diagram.png' })
        expect(image).toHaveAttribute('src', `data:image/png;base64,${encodeBase64(imageBytes)}`)
        expect(screen.getByText('image/png')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Open image' })).toHaveAttribute('download', 'diagram.png')
        expect(screen.queryByText('This looks like a binary file. It cannot be displayed.')).not.toBeInTheDocument()
    })

    it('allows changed image files to switch between diff and preview', () => {
        mockState.diffQuery = {
            data: { success: true, stdout: 'Binary files a/assets/icon.webp and b/assets/icon.webp differ', error: undefined },
            isLoading: false,
        }
        setFile('assets/icon.webp', '\x00webp-image')

        render(<FilePage />)

        expect(screen.getByRole('button', { name: 'Diff' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
        expect(screen.getByRole('img', { name: 'icon.webp' })).toHaveAttribute('src', `data:image/webp;base64,${encodeBase64('\x00webp-image')}`)

        fireEvent.click(screen.getByRole('button', { name: 'Diff' }))

        expect(screen.getByText('Binary files a/assets/icon.webp and b/assets/icon.webp differ')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

        expect(screen.getByRole('img', { name: 'icon.webp' })).toBeInTheDocument()
    })

    it('keeps unsupported binary files hidden', () => {
        setFile('archives/data.zip', '\x00\x01zip')

        render(<FilePage />)

        expect(screen.getByText('This looks like a binary file. It cannot be displayed.')).toBeInTheDocument()
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it.each([
        ['report.pdf', '%PDF-1.7\n\x00document'],
        ['proposal.docx', 'PK\x03\x04\x00word-document'],
        ['budget.xlsx', 'PK\x03\x04\x00excel-workbook'],
    ])('renders a preview surface for %s', (path, content) => {
        setFile(path, content)

        render(<FilePage />)

        expect(screen.getByRole('region', { name: `${path} preview` })).toBeInTheDocument()
        expect(screen.queryByText('This looks like a binary file. It cannot be displayed.')).not.toBeInTheDocument()
    })

    it.each([
        ['notes.txt', 'plain text'],
        ['archives/data.zip', '\x00\x01zip'],
        ['assets/diagram.png', '\x00\x01image'],
    ])('downloads %s from the file toolbar', async (path, content) => {
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
        setFile(path, content)

        render(<FilePage />)
        fireEvent.click(screen.getByRole('button', { name: 'Download file' }))

        await waitFor(() => {
            expect(URL.createObjectURL).toHaveBeenCalledOnce()
            expect(anchorClick).toHaveBeenCalledOnce()
        })
    })

    it('shows a visible error when a file download fails', async () => {
        setFile('archives/data.zip', '\x00\x01zip')
        mockState.fileQuery = {
            data: { success: false, error: 'Permission denied' },
            isLoading: false,
        }
        mockState.readSessionFile.mockResolvedValue({ success: false, error: 'Permission denied' })

        render(<FilePage />)
        fireEvent.click(screen.getByRole('button', { name: 'Download file' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Download failed: Permission denied')
        expect(URL.createObjectURL).not.toHaveBeenCalled()
    })
})
