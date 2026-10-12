import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { MarkdownLinkBehaviorProvider } from './markdown-link-behavior'
import { CodexFollowupProvider } from './codex-directive'

const followup = ':codex-followup[合并应用清单]{prompt="将应用一和应用三的清单合并为一个 CSV，增加应用列。"}'
const { copy } = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/clipboard', () => ({ safeCopyToClipboard: copy }))

afterEach(cleanup)

describe('Codex directive rendering', () => {
    beforeEach(() => copy.mockClear())
    it('inserts the complete followup only after an explicit click', () => {
        const insert = vi.fn()
        render(
            <CodexFollowupProvider onInsertPrompt={insert}>
                <MarkdownRenderer content={'- ' + followup} />
            </CodexFollowupProvider>
        )
        expect(insert).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '合并应用清单' }))
        expect(insert).toHaveBeenCalledExactlyOnceWith('将应用一和应用三的清单合并为一个 CSV，增加应用列。')
        expect(screen.getByRole('status')).toHaveTextContent('Added to the composer')
    })

    it('keeps followups inert in shared/read-only previews', () => {
        render(<MarkdownRenderer content={followup} />)
        expect(screen.getByRole('button', { name: '合并应用清单' })).toBeDisabled()
        expect(screen.getByText('将应用一和应用三的清单合并为一个 CSV，增加应用列。')).toBeInTheDocument()
    })

    it('waits for a complete streamed directive before rendering a button', () => {
        const { rerender } = render(<MarkdownRenderer content={followup.slice(0, -2)} />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        rerender(<MarkdownRenderer content={followup} />)
        expect(screen.getByRole('button', { name: '合并应用清单' })).toBeInTheDocument()
    })

    it('renders review feedback with a safe file link and literal body text', () => {
        const { container } = render(
            <MarkdownLinkBehaviorProvider behavior="copy-non-file" sessionId="s1" workingDirectory="/repo">
                <MarkdownRenderer content={'::code-comment{title="Off-by-one" body="<img src=x onerror=alert(1)> **not HTML**" file="/repo/src/a.ts" start=10 end=12 priority=2}'} />
            </MarkdownLinkBehaviorProvider>
        )
        expect(screen.getByText('P2')).toBeInTheDocument()
        expect(screen.getByText('Off-by-one')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: '/repo/src/a.ts:10–12' })).toHaveAttribute('href', expect.stringContaining('/sessions/s1/file?'))
        expect(container.querySelector('img')).not.toBeInTheDocument()
        expect(container.textContent).toContain('<img src=x onerror=alert(1)> **not HTML**')
    })

    it('renders inbox summaries without creating server-side state', () => {
        render(<MarkdownRenderer content={'::inbox-item{title="处理完成" summary="合并了 2 个清单"}'} />)
        expect(screen.getByText('处理完成')).toBeInTheDocument()
        expect(screen.getByText('合并了 2 个清单')).toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it.each([
        '::git-stage{cwd="/repo"}',
        '::git-commit{cwd="/repo"}',
        '::git-create-branch{cwd="/repo" branch="feature"}',
        '::git-push{cwd="/repo" branch="feature"}',
        '::git-create-pr{cwd="/repo" branch="feature" url="javascript:alert(1)" isDraft=true}',
        '::archive-thread{reason="Task complete"}',
        '::automation-update{mode="create" name="Daily" prompt="Check" rrule="FREQ=DAILY"}',
        '::artifact-template{title="Template" path="/tmp/template.xlsx"}',
        '::codex-inline-vis{file="/tmp/chart.html"}',
        '::codex-live-vis{path="/tmp/chart.html" title="Chart"}',
        ':codex-annotation{index="1"}',
        ':codex-resource{index="2"}',
    ])('renders native-only directives without executing them: %s', (content) => {
        const { container } = render(<MarkdownRenderer content={content} />)
        expect(screen.getByText(/Display only/)).toBeInTheDocument()
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        expect(container.querySelector('iframe, script, a[href^="javascript:"]')).not.toBeInTheDocument()
    })

    it('blocks file references outside the workspace and unsafe citation schemes', () => {
        render(
            <MarkdownLinkBehaviorProvider behavior="navigate" sessionId="s1" workingDirectory="/repo">
                <MarkdownRenderer content={':codex-file-citation{path="/etc/passwd"}\n\n:codex-file-citation{path="javascript:alert(1)"}\n\n::code-comment{title="A" body="B" file="../../secret" start=1}'} />
            </MarkdownLinkBehaviorProvider>
        )
        expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('uses the same directive parser alongside math and repaired tables', () => {
        const { container } = render(
            <MarkdownRenderer content={followup + '\n\n\\(x^2\\)\n\n| A | B | C |\n| --- | --- |\n| 1 | 2 | 3 |'} />
        )
        expect(screen.getByRole('button', { name: '合并应用清单' })).toBeInTheDocument()
        expect(container.querySelector('.katex')).toBeInTheDocument()
        expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('rejects malformed internal marker links instead of navigating to a custom scheme', () => {
        render(<MarkdownRenderer content={'[unsafe](hapi-codex-directive:%7B%7D) [file](hapi-codex-file:%7B%7D)'} />)
        expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('renders and copies a writing draft without interpreting its contents as actions', async () => {
        const body = 'Dear team,\n\n' + followup + '\n\nThanks.'
        render(<MarkdownRenderer content={':::writing{variant="email" id="12345" subject="合并清单"}\n' + body + '\n:::'} />)
        expect(screen.getByText('合并清单')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '合并应用清单' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
        await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith(body))
    })
})
