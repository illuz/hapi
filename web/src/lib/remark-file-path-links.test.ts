import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { toHtml } from 'hast-util-to-html'
import remarkFilePathLinks from './remark-file-path-links'

function render(markdown: string): string {
    const processor = unified().use(remarkParse).use(remarkFilePathLinks).use(remarkRehype)
    return toHtml(processor.runSync(processor.parse(markdown), markdown) as never)
}

describe('remarkFilePathLinks', () => {
    it('links repository paths and preserves punctuation', () => {
        const html = render('See src/app.ts:42 and docs/guide.md.')
        expect(html).toContain('href="hapi-file:src%2Fapp.ts"')
        expect(html).toContain('href="hapi-file:docs%2Fguide.md"')
        expect(html).toContain('>docs/guide.md</a>.</p>')
    })

    it('does not link URLs, code, or absolute paths', () => {
        const html = render('https://example.com/a.ts `/tmp/a.ts` /tmp/a.ts')
        expect(html).not.toContain('hapi-file:')
        expect(html).toContain('/tmp/a.ts')
    })
})
