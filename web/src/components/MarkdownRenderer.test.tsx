import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { isSessionFileHref, MarkdownLinkBehaviorProvider } from '@/components/assistant-ui/markdown-link-behavior'
import { decodeBase64 } from '@/lib/utils'

const { mockSafeCopyToClipboard, mockHapticNotification } = vi.hoisted(() => ({
    mockSafeCopyToClipboard: vi.fn(),
    mockHapticNotification: vi.fn()
}))

vi.mock('@/lib/clipboard', () => ({
    safeCopyToClipboard: mockSafeCopyToClipboard
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            notification: mockHapticNotification
        }
    })
}))

describe('MarkdownRenderer', () => {
    beforeEach(() => {
        mockSafeCopyToClipboard.mockReset()
        mockSafeCopyToClipboard.mockResolvedValue(undefined)
        mockHapticNotification.mockReset()
    })

    it('renders outside assistant thread message context', () => {
        render(<MarkdownRenderer content={'# Preview\n\nOpen [notes](./notes.md).'} />)

        expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'notes' })).toHaveAttribute('href', './notes.md')
    })

    it('copies ordinary links instead of navigating in session Markdown', async () => {
        render(
            <MarkdownLinkBehaviorProvider behavior="copy-non-file">
                <MarkdownRenderer content={'Open [site](https://example.com/docs).'} />
            </MarkdownLinkBehaviorProvider>
        )

        const link = screen.getByRole('link', { name: 'site' })
        const event = new MouseEvent('click', { bubbles: true, cancelable: true })

        expect(link.dispatchEvent(event)).toBe(false)
        await waitFor(() => {
            expect(mockSafeCopyToClipboard).toHaveBeenCalledWith('https://example.com/docs')
        })
        expect(screen.getByRole('status')).toHaveTextContent('Copied')
        expect(mockHapticNotification).toHaveBeenCalledWith('success')
    })

    it('keeps session file links marked for normal navigation in session Markdown', () => {
        render(
            <MarkdownLinkBehaviorProvider behavior="copy-non-file">
                <MarkdownRenderer content={'Open [report](/sessions/session-1/file?path=abc).'} />
            </MarkdownLinkBehaviorProvider>
        )

        const link = screen.getByRole('link', { name: 'report' })

        expect(isSessionFileHref(link.getAttribute('href') ?? undefined)).toBe(true)
        expect(link).not.toHaveAttribute('title', 'Copy link')
    })

    it('turns local paths into session file preview links', () => {
        render(
            <MarkdownLinkBehaviorProvider
                behavior="copy-non-file"
                sessionId="session-1"
                workingDirectory="/workspace/project"
            >
                <MarkdownRenderer content={'Open [source](/workspace/project/src/app.ts:42).'} />
            </MarkdownLinkBehaviorProvider>
        )

        const link = screen.getByRole('link', { name: 'source' })
        const href = link.getAttribute('href') ?? ''
        const url = new URL(href, 'https://hapi.local')
        const decodedPath = decodeBase64(url.searchParams.get('path') ?? '')

        expect(isSessionFileHref(href)).toBe(true)
        expect(decodedPath).toEqual({ text: 'src/app.ts', ok: true })
        expect(link).not.toHaveAttribute('title', 'Copy link')
    })

    it('turns file URLs into session file preview links before URL sanitization', () => {
        render(
            <MarkdownLinkBehaviorProvider
                behavior="copy-non-file"
                sessionId="session-1"
                workingDirectory="/workspace/project"
            >
                <MarkdownRenderer content={'Open [guide](file:///workspace/project/docs/My%20Guide.md#L8).'} />
            </MarkdownLinkBehaviorProvider>
        )

        const href = screen.getByRole('link', { name: 'guide' }).getAttribute('href') ?? ''
        const url = new URL(href, 'https://hapi.local')
        const decodedPath = decodeBase64(url.searchParams.get('path') ?? '')

        expect(isSessionFileHref(href)).toBe(true)
        expect(decodedPath).toEqual({ text: 'docs/My Guide.md', ok: true })
    })

    it('turns system temporary paths into session file preview links', () => {
        render(
            <MarkdownLinkBehaviorProvider
                behavior="copy-non-file"
                sessionId="session-1"
                workingDirectory="/workspace/project"
            >
                <MarkdownRenderer content={'Open [certificate](/tmp/donation-certificate-detail-v3.png).'} />
            </MarkdownLinkBehaviorProvider>
        )

        const link = screen.getByRole('link', { name: 'certificate' })
        const href = link.getAttribute('href') ?? ''
        const url = new URL(href, 'https://hapi.local')
        const decodedPath = decodeBase64(url.searchParams.get('path') ?? '')

        expect(isSessionFileHref(href)).toBe(true)
        expect(decodedPath).toEqual({ text: '/tmp/donation-certificate-detail-v3.png', ok: true })
        expect(link).not.toHaveAttribute('title', 'Copy link')
    })

    it('keeps out-of-workspace absolute paths copyable', () => {
        render(
            <MarkdownLinkBehaviorProvider
                behavior="copy-non-file"
                sessionId="session-1"
                workingDirectory="/workspace/project"
            >
                <MarkdownRenderer content={'Open [system file](/etc/passwd).'} />
            </MarkdownLinkBehaviorProvider>
        )

        expect(screen.getByRole('link', { name: 'system file' })).toHaveAttribute('title', 'Copy link')
    })

    it('does not treat external URLs with file-like paths as session file links', () => {
        expect(isSessionFileHref('https://example.com/sessions/session-1/file?path=abc')).toBe(false)
    })
})
