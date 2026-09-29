import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import { toHtml } from 'hast-util-to-html'
import remarkSafeDollarMath from './remark-safe-dollar-math'

function render(markdown: string): string {
    const processor = unified()
        .use(remarkParse)
        .use(remarkMath, { singleDollarTextMath: false })
        .use(remarkSafeDollarMath)
        .use(remarkRehype)
        .use(rehypeKatex)
    return toHtml(processor.runSync(processor.parse(markdown), markdown) as never)
}

describe('remarkSafeDollarMath', () => {
    it('keeps TeX-like single-dollar expressions working', () => {
        const html = render(String.raw`Euler: $e^{i\pi}+1=0$`)
        expect(html).toContain('class="katex"')
    })

    it('does not turn currency prose into KaTeX', () => {
        const html = render('Budget: $200/mo and a $80 bill')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('$200/mo')
        expect(html).toContain('$80 bill')
    })

    it('does not rewrite code spans', () => {
        const html = render('`$x^2$`')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('$x^2$')
    })
})

