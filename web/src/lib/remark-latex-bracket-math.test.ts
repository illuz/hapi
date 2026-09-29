import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { toHtml } from 'hast-util-to-html'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_REHYPE_PLUGINS,
} from '@/components/assistant-ui/markdown-text'
import { repairMarkdownTables } from './remark-repair-tables'

function render(markdown: string): string {
    const processor = unified()
        .use(remarkParse)
        .use(MARKDOWN_PLUGINS)
        .use(remarkRehype)
        .use(MARKDOWN_REHYPE_PLUGINS)

    return toHtml(processor.runSync(processor.parse(markdown), markdown) as never)
}

describe('bracket-delimited math', () => {
    it('renders inline and display formulas through the shared Markdown pipeline', () => {
        const html = render(String.raw`Result: \(x^2\).

\[
E = mc^2
\]`)

        expect(html.match(/class="katex"/g)).toHaveLength(2)
        expect(html).toContain('class="katex-display"')
        expect(html).not.toContain(String.raw`\(x^2\)`)
        expect(html).not.toContain('\\[')
        expect(html).not.toContain('\\]')
    })

    it('keeps bracket-looking text inside fenced code untouched', () => {
        const html = render('`\\(not math\\)`')

        expect(html).not.toContain('class="katex"')
        expect(html).toContain('not math')
    })
})

describe('repairMarkdownTables', () => {
    it('pads a short GFM separator without changing fenced examples', () => {
        const table = '| A | B | C |\n|---|---|\n| x | y | z |\n'
        expect(repairMarkdownTables(table)).toContain('|---|---| --- |')

        const fenced = '```\n| A | B | C |\n|---|---|\n```\n'
        expect(repairMarkdownTables(fenced)).toBe(fenced)
    })
})
