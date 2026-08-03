import { describe, expect, it } from 'vitest'
import { decodeBase64 } from '@/lib/utils'
import { buildSessionFileMarkdownLink, linkAssistantFilePaths, resolveLocalFileHref } from './filePathLinks'

function extractEncodedPath(markdownLink: string): string {
    const match = markdownLink.match(/[?&]path=([^)]*)/)
    expect(match).not.toBeNull()
    return decodeURIComponent(match![1])
}

function decodeLinkPath(markdownLink: string): string {
    const decoded = decodeBase64(extractEncodedPath(markdownLink))
    expect(decoded.ok).toBe(true)
    return decoded.text
}

describe('buildSessionFileMarkdownLink', () => {
    it('builds a file preview link with a base64 encoded path', () => {
        const link = buildSessionFileMarkdownLink('session-1', '.workflow/report.md')

        expect(link).toContain('[.workflow/report.md](/sessions/session-1/file?path=')
        expect(decodeLinkPath(link)).toBe('.workflow/report.md')
    })
})

describe('resolveLocalFileHref', () => {
    it('resolves relative file links and removes source positions', () => {
        const href = resolveLocalFileHref('src/components/App.tsx:42:7', 'session-1', '/workspace/project')
        const basenameHref = resolveLocalFileHref('App.tsx:42', 'session-1', '/workspace/project')

        expect(href).not.toBeNull()
        expect(decodeLinkPath(`[file](${href})`)).toBe('src/components/App.tsx')
        expect(basenameHref).not.toBeNull()
        expect(decodeLinkPath(`[file](${basenameHref})`)).toBe('App.tsx')
    })

    it('resolves absolute paths inside the session working directory', () => {
        const href = resolveLocalFileHref('/workspace/project/docs/guide.md#L12', 'session-1', '/workspace/project')

        expect(href).not.toBeNull()
        expect(decodeLinkPath(`[file](${href})`)).toBe('docs/guide.md')
    })

    it('keeps system temporary paths absolute for session file previews', () => {
        const href = resolveLocalFileHref('/tmp/donation-certificate-detail-v3.png', 'session-1', '/workspace/project')

        expect(href).not.toBeNull()
        expect(decodeLinkPath(`[file](${href})`)).toBe('/tmp/donation-certificate-detail-v3.png')
    })

    it('resolves local file URLs with encoded characters', () => {
        const href = resolveLocalFileHref('file:///workspace/project/docs/My%20Guide.md#L8', 'session-1', '/workspace/project')

        expect(href).not.toBeNull()
        expect(decodeLinkPath(`[file](${href})`)).toBe('docs/My Guide.md')
    })

    it('resolves Windows paths case-insensitively', () => {
        const href = resolveLocalFileHref('c:\\WORKSPACE\\project\\src\\app.ts:9', 'session-1', 'C:\\workspace\\project')

        expect(href).not.toBeNull()
        expect(decodeLinkPath(`[file](${href})`)).toBe('src/app.ts')
    })

    it('does not resolve external URLs or paths outside the working directory', () => {
        expect(resolveLocalFileHref('https://example.com/docs', 'session-1', '/workspace/project')).toBeNull()
        expect(resolveLocalFileHref('urn:123', 'session-1', '/workspace/project')).toBeNull()
        expect(resolveLocalFileHref('/etc/passwd', 'session-1', '/workspace/project')).toBeNull()
        expect(resolveLocalFileHref('../secret.txt', 'session-1', '/workspace/project')).toBeNull()
    })
})

describe('linkAssistantFilePaths', () => {
    it('links Markdown and JSON paths in normal assistant text', () => {
        const output = linkAssistantFilePaths(
            'Created .workflow/summary/report.md and .workflow/summary/plan.json. src/app.ts is source.',
            'session-1'
        )

        expect(output).toContain('[.workflow/summary/report.md](/sessions/session-1/file?path=')
        expect(output).toContain('[.workflow/summary/plan.json](/sessions/session-1/file?path=')
        expect(output).toContain('src/app.ts is source')
    })

    it('does not double-link existing Markdown links', () => {
        const output = linkAssistantFilePaths(
            'Open [report](.workflow/summary/report.md) or .workflow/summary/plan.json.',
            'session-1'
        )

        expect(output).toContain('[report](.workflow/summary/report.md)')
        expect(output).toContain('[.workflow/summary/plan.json](/sessions/session-1/file?path=')
    })

    it('turns inline code that only contains a path into a preview link', () => {
        const output = linkAssistantFilePaths(
            'See `.workflow/summary/report.md`, but keep `bun test` as code.',
            'session-1'
        )

        expect(output).toContain('[.workflow/summary/report.md](/sessions/session-1/file?path=')
        expect(output).toContain('`bun test`')
    })

    it('unwraps path-only fenced code blocks so links can render', () => {
        const output = linkAssistantFilePaths(
            'Artifacts:\n```text\n.workflow/summary/report.md\n.workflow/summary/plan.json\n```\nDone.',
            'session-1'
        )

        expect(output).not.toContain('```')
        expect(output).toContain('[.workflow/summary/report.md](/sessions/session-1/file?path=')
        expect(output).toContain('[.workflow/summary/plan.json](/sessions/session-1/file?path=')
    })

    it('leaves real code fences untouched', () => {
        const input = '```json\n{ "path": ".workflow/summary/plan.json" }\n```'
        const output = linkAssistantFilePaths(input, 'session-1')

        expect(output).toBe(input)
    })
})
