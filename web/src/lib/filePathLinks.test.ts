import { describe, expect, it } from 'vitest'
import { decodeBase64 } from '@/lib/utils'
import { buildSessionFileMarkdownLink, linkAssistantFilePaths } from './filePathLinks'

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
