import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
        data: { success: true, content: '' },
        isLoading: false,
    },
    copy: vi.fn(),
    goBack: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => mockState.search,
}))

vi.mock('@tanstack/react-query', () => ({
    useQuery: (options: { queryKey: readonly unknown[] }) => {
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
            readSessionFile: vi.fn(),
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
})
