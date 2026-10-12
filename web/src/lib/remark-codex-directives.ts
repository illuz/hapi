import type { Processor } from 'unified'
import type { Root, Nodes } from 'mdast'
import type { VFile } from 'vfile'
import {
    encodeCodexDirectiveHref,
    isSupportedCodexDirective,
    parseCodexDirective,
} from './codexDirectives'
import { citationFromAttributes, encodeCodexFileCitationHref } from './codexFileCitation'

const OPAQUE_TYPES = new Set([
    'code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference',
    'definition', 'math', 'inlineMath',
])

function protectedRanges(tree: Root): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = []
    function visit(node: Nodes) {
        if (OPAQUE_TYPES.has(node.type)) {
            const start = node.position?.start.offset
            const end = node.position?.end.offset
            if (start !== undefined && end !== undefined) ranges.push({ start, end })
            return
        }
        if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
    return ranges.sort((a, b) => a.start - b.start)
}

/** 静态预览和流式消息共享解析入口；只改渲染副本，不改存储的消息。 */
export default function remarkCodexDirectives(this: Processor) {
    const processor = this
    return (tree: Root, file: VFile) => {
        const source = String(file.value)
        if (!/:[a-z][a-z-]*(?:\[|\{)/.test(source)) return
        const ranges = protectedRanges(tree)
        const pattern = /:{1,3}[a-z][a-z0-9-]*(?=\[|\{)/g
        let rangeIndex = 0
        let cursor = 0
        let scanUntil = 0
        const parts: string[] = []
        for (const match of source.matchAll(pattern)) {
            const start = match.index
            if (start < scanUntil || (start > 0 && /[\w:]/.test(source[start - 1]))) continue
            let escapes = 0
            for (let i = start - 1; i >= 0 && source[i] === '\\'; i--) escapes++
            if (escapes % 2 !== 0) continue
            while (ranges[rangeIndex] && ranges[rangeIndex].end <= start) rangeIndex++
            if (ranges[rangeIndex] && ranges[rangeIndex].start <= start) continue
            const directive = parseCodexDirective(source.slice(start))
            if (!directive) {
                // 流式写作块尚未闭合时，不把正文里的示例指令误当成操作入口。
                if (match[0] === ':::writing'
                    && /^ {0,3}$/.test(source.slice(source.lastIndexOf('\n', start - 1) + 1, start))) {
                    scanUntil = source.length
                }
                continue
            }
            scanUntil = start + directive.raw.length
            if (!isSupportedCodexDirective(directive)) continue
            if (directive.name === 'writing'
                && !/^ {0,3}$/.test(source.slice(source.lastIndexOf('\n', start - 1) + 1, start))) continue
            const citation = directive.name === 'codex-file-citation'
                ? citationFromAttributes(directive.attributes)
                : null
            const href = citation ? encodeCodexFileCitationHref(citation) : encodeCodexDirectiveHref(directive)
            // 标签在 React 中按纯文本绘制，避免属性中的 Markdown 再次进入解析器。
            parts.push(source.slice(cursor, start), '[codex](' + href + ')')
            cursor = start + directive.raw.length
        }
        if (cursor === 0) return
        parts.push(source.slice(cursor))
        const rewritten = parts.join('')
        Object.assign(tree, processor.parse(rewritten))
        // 后续表格和数学插件会重新读取源码，因此同步这一渲染副本。
        file.value = rewritten
    }
}
