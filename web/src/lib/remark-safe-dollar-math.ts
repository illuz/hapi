/**
 * Recover the useful `$...$` shorthand without interpreting currency values as
 * mathematics.  Upstream disables single-dollar parsing because prose such as
 * `$200/mo ... $80 bill` otherwise becomes a malformed KaTeX expression.  We
 * keep the shorthand for expressions that contain an unmistakable TeX cue
 * (commands, superscripts/subscripts, braces, or an operator) and leave all
 * other dollar text untouched.
 */

type MarkdownNode = {
    type?: string
    value?: string
    children?: MarkdownNode[]
    data?: unknown
}

const INLINE_DOLLAR_MATH = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g
const TEX_CUE = /\\[A-Za-z]+|[\^_{}]|(?:\d|[A-Za-z])\s*[=+\-*/]\s*(?:\d|[A-Za-z])/u

function looksLikeMath(value: string): boolean {
    const body = value.trim()
    if (!body || !TEX_CUE.test(body)) return false

    // A pair of dollars often brackets a sentence containing prices.  Reject
    // the common currency shape before considering the generic operator cue.
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:\/\s*(?:mo|month|hr|hour|day|wk|week))?\b/i.test(body)) {
        return false
    }
    if (/\b(?:and|or|bill|budget|price|cost|usd|eur|cny)\b/i.test(body)) {
        return false
    }
    return true
}

function rewriteTextNode(node: MarkdownNode): MarkdownNode[] {
    const value = node.value ?? ''
    INLINE_DOLLAR_MATH.lastIndex = 0
    const parts: MarkdownNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = INLINE_DOLLAR_MATH.exec(value)) !== null) {
        const body = match[1] ?? ''
        if (!looksLikeMath(body)) continue

        if (match.index > lastIndex) {
            parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })
        }
        const mathValue = body.trim()
        parts.push({
            type: 'inlineMath',
            value: mathValue,
            data: {
                hName: 'code',
                hProperties: { className: ['language-math', 'math-inline'] },
                hChildren: [{ type: 'text', value: mathValue }]
            }
        })
        lastIndex = match.index + match[0].length
    }

    if (parts.length === 0) return [node]
    if (lastIndex < value.length) {
        parts.push({ type: 'text', value: value.slice(lastIndex) })
    }
    return parts
}

function visit(node: MarkdownNode, parentType: string | null): void {
    if (!node.children) return

    // Code nodes are intentionally opaque: `$x^2$` in a command example must
    // remain literal text.
    if (node.type === 'code' || node.type === 'inlineCode' || parentType === 'link') return

    const children: MarkdownNode[] = []
    for (const child of node.children) {
        if (child.type === 'text') {
            children.push(...rewriteTextNode(child))
            continue
        }
        visit(child, child.type ?? null)
        children.push(child)
    }
    node.children = children
}

export default function remarkSafeDollarMath() {
    return (tree: MarkdownNode) => visit(tree, null)
}
