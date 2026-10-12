export type CodexDirective = {
    name: string
    label?: string
    body?: string
    attributes: Record<string, string>
}

export const CODEX_DIRECTIVE_HREF_PREFIX = 'hapi-codex-directive:'
const MAX_DIRECTIVE_LENGTH = 32_768

// 只为已知标记提供 UI；未知标记保留原文，不猜测其操作语义。
const SUPPORTED_DIRECTIVES = new Set([
    'codex-followup', 'codex-file-citation', 'code-comment', 'inbox-item',
    'archive-thread', 'automation-update', 'artifact-template',
    'codex-inline-vis', 'codex-live-vis',
    'git-stage', 'git-commit', 'git-create-branch', 'git-push', 'git-create-pr',
    'writing', 'codex-annotation', 'codex-resource',
])

export function isSupportedCodexDirective(directive: CodexDirective): boolean {
    if (!SUPPORTED_DIRECTIVES.has(directive.name)) return false
    const attrs = directive.attributes
    switch (directive.name) {
        case 'codex-followup':
            return Boolean(directive.label?.trim() && attrs.prompt?.trim())
        case 'codex-file-citation':
            return Boolean(attrs.path?.trim())
        case 'code-comment':
            return Boolean(attrs.title?.trim() && attrs.body?.trim() && attrs.file?.trim())
        case 'inbox-item':
            return Boolean(attrs.title?.trim() && attrs.summary?.trim())
        case 'writing':
            return Boolean(attrs.variant?.trim() && attrs.id?.trim() && directive.body?.trim())
        case 'codex-annotation':
            return /^[1-9]\d*$/.test(attrs.index ?? '')
        default:
            return true
    }
}

function parseWritingBody(source: string, start: number, limit: number): { body: string; end: number } | null {
    const newline = /^[ \t]*\r?\n/.exec(source.slice(start, limit))
    if (!newline) return null
    const bodyStart = start + newline[0].length
    let offset = bodyStart
    let fence: { char: string; length: number } | null = null
    for (const line of source.slice(bodyStart, limit).match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        const marker = /^ {0,3}(\x60{3,}|~{3,})([^\r\n]*)/.exec(line)
        if (fence) {
            if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null
        } else if (marker) {
            fence = { char: marker[1][0], length: marker[1].length }
        } else if (/^ {0,3}:::[ \t]*(?:\r?\n)?$/.test(line)) {
            return {
                body: source.slice(bodyStart, offset).replace(/\r?\n$/, ''),
                end: offset + line.replace(/\r?\n$/, '').length,
            }
        }
        offset += line.length
    }
    return null
}

/** 解析单个完整指令。引号内的括号、Markdown 和换行都属于属性值。 */
export function parseCodexDirective(source: string): (CodexDirective & { raw: string }) | null {
    const opening = /^:{1,3}([a-z][a-z0-9-]*)/.exec(source)
    if (!opening) return null
    const name = opening[1]
    const limit = Math.min(source.length, MAX_DIRECTIVE_LENGTH)
    let cursor = opening[0].length
    let label: string | undefined
    if (source[cursor] === '[') {
        cursor++
        let value = ''
        while (cursor < limit && source[cursor] !== ']') {
            if (source[cursor] === '\n') return null
            if (source[cursor] === '\\' && /[\]\\]/.test(source[cursor + 1] ?? '')) cursor++
            value += source[cursor++]
        }
        if (source[cursor++] !== ']') return null
        label = value
    }
    if (source[cursor++] !== '{') return null
    const attributes: Record<string, string> = Object.create(null)
    while (cursor < limit) {
        while (cursor < limit && /\s/.test(source[cursor])) cursor++
        if (source[cursor] === '}') {
            if (name === 'writing') {
                if (!source.startsWith(':::writing{')) return null
                const writing = parseWritingBody(source, cursor + 1, limit)
                return writing ? { name, attributes, body: writing.body, raw: source.slice(0, writing.end) } : null
            }
            return { name, label, attributes, raw: source.slice(0, cursor + 1) }
        }
        const key = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(cursor, limit))?.[0]
        if (!key || Object.hasOwn(attributes, key)) return null
        cursor += key.length
        while (cursor < limit && /\s/.test(source[cursor])) cursor++
        if (source[cursor++] !== '=') return null
        while (cursor < limit && /\s/.test(source[cursor])) cursor++
        const quote = source[cursor]
        let value = ''
        if (quote === '"' || quote === "'") {
            cursor++
            while (cursor < limit && source[cursor] !== quote) {
                // Git 标记中的反斜线为字面值，与上游 Windows 路径处理一致。
                if (!name.startsWith('git-') && source[cursor] === '\\'
                    && (source[cursor + 1] === quote || source[cursor + 1] === '\\')) cursor++
                value += source[cursor++]
            }
            if (source[cursor++] !== quote) return null
        } else {
            const match = /^[^\s{}"'=<>]+/.exec(source.slice(cursor, limit))
            if (!match) return null
            value = match[0]
            cursor += value.length
        }
        if (source[cursor] !== '}' && !/\s/.test(source[cursor] ?? '')) return null
        attributes[key] = value
    }
    return null
}

export function encodeCodexDirectiveHref(directive: CodexDirective): string {
    const { name, label, body, attributes } = directive
    return CODEX_DIRECTIVE_HREF_PREFIX + encodeURIComponent(JSON.stringify({ name, label, body, attributes }))
}

export function decodeCodexDirectiveHref(href: string | undefined): CodexDirective | null {
    if (!href?.startsWith(CODEX_DIRECTIVE_HREF_PREFIX) || href.length > MAX_DIRECTIVE_LENGTH * 12) return null
    try {
        const value: unknown = JSON.parse(decodeURIComponent(href.slice(CODEX_DIRECTIVE_HREF_PREFIX.length)))
        if (!value || typeof value !== 'object') return null
        const directive = value as Partial<CodexDirective>
        if (typeof directive.name !== 'string'
            || (directive.label !== undefined && typeof directive.label !== 'string')
            || (directive.body !== undefined && typeof directive.body !== 'string')
            || !directive.attributes || typeof directive.attributes !== 'object'
            || Array.isArray(directive.attributes)
            || !Object.values(directive.attributes).every((item) => typeof item === 'string')) return null
        return isSupportedCodexDirective(directive as CodexDirective) ? directive as CodexDirective : null
    } catch {
        return null
    }
}
