import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { toHtml } from 'hast-util-to-html'
import remarkCodexDirectives from './remark-codex-directives'
import { linkAssistantFilePaths } from './filePathLinks'

function render(markdown: string) {
    const processor = unified().use(remarkParse).use(remarkCodexDirectives).use(remarkRehype)
    return toHtml(processor.runSync(processor.parse(markdown), markdown) as never)
}

describe('remarkCodexDirectives', () => {
    const followup = ':codex-followup[合并应用清单]{prompt="将应用一和应用三合并为 CSV。"}'
    const citation = ':codex-file-citation{path="/tmp/总表.xlsx" sheet="汇总表" range="B1:X106"}'

    it('renders inline, list, block and multiple directives', () => {
        const html = render('来源 ' + citation + '\n\n- ' + followup + '\n- ' + followup
            + '\n\n::inbox-item{title="完成" summary="已经完成处理"}')
        expect(html.match(/hapi-codex-directive:/g)).toHaveLength(3)
        expect(html.match(/hapi-codex-file:/g)).toHaveLength(1)
        expect(html).not.toContain(':codex-followup[')
        expect(render(':' + citation)).not.toContain(':codex-file-citation{')
    })

    it.each([
        '`' + followup + '`',
        '``' + followup + '\n' + followup + '``',
        '```text\n' + followup + '\n```',
        '> ```\n> ' + followup + '\n> ```',
        '- ```\n  ' + followup + '\n  ```',
        '~~~\n' + followup + '\n~~~',
        '\\' + followup,
        '[' + followup + '](https://example.com)',
        '<div>\n' + followup + '\n</div>',
    ])('does not interpret protected Markdown: %.55s', (source) => {
        expect(render(source)).not.toContain('hapi-codex-directive:')
    })

    it('keeps unknown, malformed and incomplete streaming content visible', () => {
        const raw = '::future-widget{title="保留"}'
        expect(render(raw)).toContain(raw)
        expect(render(':codex-followup[label]{prompt="未完成')).toContain('未完成')
        expect(render('::code-comment{title="缺少内容"}')).toContain('缺少内容')
        expect(render(':codex-file-citation{sheet="no path"}')).not.toContain('hapi-codex-file:')
    })

    it('keeps Markdown within attributes opaque and prevents nested directive interpretation', () => {
        const source = ':codex-followup[继续]{prompt="读取 `a.ts`、**b** 和 [link](https://example.com)，输出 {x}"}'
        expect(render(source).match(/<a /g)).toHaveLength(1)
        expect(render(source)).not.toContain('<strong>')
        const nested = '::code-comment{title="Review" body="Example: :codex-followup[x]{prompt=\'hidden\'}" file="src/a.ts"}'
        expect(render(nested).match(/hapi-codex-directive:/g)).toHaveLength(1)
        expect(render('::unknown{body="Example: :codex-followup[x]{prompt=\'hidden\'}"}')).not.toContain('hapi-codex-directive:')
    })

    it('renders writing containers as one opaque draft and preserves following prose', () => {
        const draft = ':::writing{variant="standard" id="12345"}\n' + followup + '\n:::'
        const html = render(draft + '\n\nAfter')
        expect(html.match(/hapi-codex-directive:/g)).toHaveLength(1)
        expect(html).toContain('After')
        expect(render('prefix ' + draft)).not.toContain('hapi-codex-directive:')
        expect(render(':::writing{variant="email" id="12345"}\n' + followup)).not.toContain('hapi-codex-directive:')
    })

    it('protects directive attributes from the assistant file-path preprocessor', () => {
        const source = ':codex-followup[读取]{prompt="读取 /tmp/a.csv 和 /tmp/b.csv"}\n' + citation
        expect(linkAssistantFilePaths(source, 's1')).toBe(source)
        expect(render(linkAssistantFilePaths(source, 's1'))).toContain('hapi-codex-file:')
    })
})
