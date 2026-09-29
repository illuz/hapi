/**
 * Turn conservative, repository-looking file paths into an internal marker
 * link.  The marker is resolved by `MarkdownLinkBehavior` when a session
 * context is available; keeping the AST transform context-free also makes it
 * safe for standalone file previews.
 */

const FILE_PATH_HREF_PREFIX = 'hapi-file:'
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?'])

export const COMMON_FILE_EXTENSIONS = new Set([
    'adoc', 'astro', 'bat', 'c', 'cfg', 'cjs', 'conf', 'cpp', 'css', 'csv',
    'env', 'go', 'gql', 'graphql', 'h', 'hpp', 'html', 'ini', 'java', 'js',
    'json', 'jsx', 'lock', 'md', 'mdx', 'mjs', 'mmd', 'php', 'prisma', 'py',
    'rb', 'rs', 'rst', 'scss', 'sh', 'sql', 'svelte', 'svg', 'swift', 'tex',
    'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh'
])

type MarkdownNode = {
    type?: string
    value?: string
    url?: string
    title?: string | null
    children?: MarkdownNode[]
}

const PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\.\/|[A-Za-z0-9_.-]+\/)[^\s`"'<>]*?\.(?:[A-Za-z0-9]{1,12}|lock)(?::\d+(?::\d+)?)?|(?:[A-Za-z0-9_.-]+\.(?:[A-Za-z0-9]{1,12}|lock))(?::\d+(?::\d+)?)?/g

function createFileHref(path: string): string {
    return `${FILE_PATH_HREF_PREFIX}${encodeURIComponent(path)}`
}

export function decodeFilePathHref(href: string): string | null {
    if (!href.startsWith(FILE_PATH_HREF_PREFIX)) return null
    try {
        return decodeURIComponent(href.slice(FILE_PATH_HREF_PREFIX.length))
    } catch {
        return null
    }
}

function stripLineSuffix(value: string): string {
    return value.replace(/:\d+(?::\d+)?$/, '')
}

function hasKnownFileExtension(value: string): boolean {
    const path = stripLineSuffix(value).toLowerCase()
    const dot = path.lastIndexOf('.')
    return dot > 0 && COMMON_FILE_EXTENSIONS.has(path.slice(dot + 1))
}

function splitTrailingPunctuation(value: string): { path: string; trailing: string } {
    let path = value
    let trailing = ''
    while (path.length > 0) {
        const last = path[path.length - 1]
        if (TRAILING_PUNCTUATION.has(last)) {
            trailing = last + trailing
            path = path.slice(0, -1)
            continue
        }
        if (last === ')' && path.split('(').length <= path.split(')').length) {
            trailing = last + trailing
            path = path.slice(0, -1)
            continue
        }
        if (last === ']' || last === '}') {
            trailing = last + trailing
            path = path.slice(0, -1)
            continue
        }
        break
    }
    return { path, trailing }
}

function shouldLinkPath(value: string): boolean {
    const path = stripLineSuffix(value)
    if (path.length < 3 || path.includes('://')) return false
    if (path.startsWith('/') || path.startsWith('~/') || path.startsWith('../') || path.includes('/../')) return false
    return hasKnownFileExtension(path)
}

function linkTextNode(node: MarkdownNode): MarkdownNode[] {
    const value = node.value ?? ''
    PATH_PATTERN.lastIndex = 0
    const parts: MarkdownNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = PATH_PATTERN.exec(value)) !== null) {
        const raw = match[0]
        const previous = match.index > 0 ? value[match.index - 1] : ''
        if (previous === ':' || previous === '/' || previous === '\\' || previous === '.') continue
        const { path, trailing } = splitTrailingPunctuation(raw)
        if (!shouldLinkPath(path)) continue
        if (match.index > lastIndex) {
            parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })
        }
        parts.push({
            type: 'link',
            url: createFileHref(stripLineSuffix(path)),
            title: null,
            children: [{ type: 'text', value: path }]
        })
        if (trailing) parts.push({ type: 'text', value: trailing })
        lastIndex = match.index + raw.length
    }

    if (parts.length === 0) return [node]
    if (lastIndex < value.length) parts.push({ type: 'text', value: value.slice(lastIndex) })
    return parts
}

function linkInlineCodeNode(node: MarkdownNode): MarkdownNode | null {
    const value = (node.value ?? '').trim()
    if (!value || /\s/.test(value) || !shouldLinkPath(value)) return null
    return {
        type: 'link',
        url: createFileHref(stripLineSuffix(value)),
        title: null,
        children: [{ type: 'inlineCode', value }]
    }
}

function rewriteExplicitLink(node: MarkdownNode): void {
    const url = node.url
    if (!url || url.startsWith(FILE_PATH_HREF_PREFIX)) return
    const target = stripLineSuffix(url.split(/[?#]/, 1)[0] ?? url)
    if (target.startsWith('/') || target.startsWith('~/') || target.startsWith('../') || target.includes(':')) return
    if (shouldLinkPath(target)) node.url = createFileHref(target)
}

export type RemarkFilePathLinksOptions = {
    rewriteExplicitLinks?: boolean
}

function visit(node: MarkdownNode, parentType: string | null, rewriteExplicitLinks: boolean): void {
    if (!node.children || node.type === 'code' || parentType === 'link' || parentType === 'linkReference') return
    const next: MarkdownNode[] = []
    for (const child of node.children) {
        if (child.type === 'text') {
            next.push(...linkTextNode(child))
            continue
        }
        if (child.type === 'inlineCode') {
            next.push(linkInlineCodeNode(child) ?? child)
            continue
        }
        if (child.type === 'link') {
            if (rewriteExplicitLinks) rewriteExplicitLink(child)
            next.push(child)
            continue
        }
        visit(child, child.type ?? null, rewriteExplicitLinks)
        next.push(child)
    }
    node.children = next
}

export default function remarkFilePathLinks(options: RemarkFilePathLinksOptions = {}) {
    const rewriteExplicitLinks = options.rewriteExplicitLinks !== false
    return (tree: MarkdownNode) => visit(tree, null, rewriteExplicitLinks)
}

