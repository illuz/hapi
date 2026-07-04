import { encodeBase64 } from '@/lib/utils'

const LINKABLE_FILE_EXTENSIONS = [
    'md',
    'markdown',
    'mdown',
    'mkd',
    'mkdn',
    'mdx',
    'json',
] as const

const FILE_EXTENSION_PATTERN = LINKABLE_FILE_EXTENSIONS.join('|')
const PATH_BODY_PATTERN = String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[A-Za-z0-9_@.+~-]+[\\/])*[A-Za-z0-9_@.+~-]+\.(${FILE_EXTENSION_PATTERN})`
const PATH_TOKEN_REGEX = new RegExp(PATH_BODY_PATTERN, 'gi')
const PATH_WITH_BOUNDARIES_REGEX = new RegExp(
    String.raw`(^|[\s({'",:])(${PATH_BODY_PATTERN})(?=$|[\s)\]}'",:;!?.])`,
    'gi'
)
const INLINE_CODE_REGEX = /(`+)([\s\S]*?)\1/g

function splitLinesWithEndings(value: string): string[] {
    return value.match(/[^\n]*\n|[^\n]+/g) ?? []
}

function escapeMarkdownLinkText(value: string): string {
    return value.replace(/([\\[\]])/g, '\\$1')
}

function buildSessionFileHref(sessionId: string, path: string): string {
    const encodedSessionId = encodeURIComponent(sessionId)
    const encodedPath = encodeURIComponent(encodeBase64(path))
    return `/sessions/${encodedSessionId}/file?path=${encodedPath}`
}

export function buildSessionFileMarkdownLink(sessionId: string, path: string): string {
    return `[${escapeMarkdownLinkText(path)}](${buildSessionFileHref(sessionId, path)})`
}

function findOnlyPathInDecoratedLine(line: string): string | null {
    const matches = Array.from(line.matchAll(PATH_TOKEN_REGEX))
    if (matches.length !== 1) return null

    const match = matches[0]
    const path = match[0]
    const index = match.index ?? -1
    if (index < 0) return null

    const remainder = `${line.slice(0, index)}${line.slice(index + path.length)}`.trim()
    if (remainder && !/^[\s"'`[\](),;:*+\-.0-9]+$/.test(remainder)) {
        return null
    }
    return path
}

function isPathOnlyCodeContent(content: string): boolean {
    const lines = content.split('\n')
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    return nonEmptyLines.length > 0
        && nonEmptyLines.every((line) => findOnlyPathInDecoratedLine(line) !== null)
}

function linkifyPlainText(value: string, sessionId: string): string {
    return value.replace(PATH_WITH_BOUNDARIES_REGEX, (match, prefix: string, path: string, _ext: string, offset: number) => {
        const previousChar = offset > 0 ? value[offset - 1] : ''
        if (prefix === '(' && previousChar === ']') {
            return match
        }
        return `${prefix}${buildSessionFileMarkdownLink(sessionId, path)}`
    })
}

function linkifyInlineCodeAwareText(value: string, sessionId: string): string {
    let result = ''
    let lastIndex = 0

    for (const match of value.matchAll(INLINE_CODE_REGEX)) {
        const index = match.index ?? 0
        const raw = match[0]
        const code = match[2] ?? ''
        result += linkifyPlainText(value.slice(lastIndex, index), sessionId)

        const codePath = findOnlyPathInDecoratedLine(code.trim())
        result += codePath
            ? buildSessionFileMarkdownLink(sessionId, codePath)
            : raw
        lastIndex = index + raw.length
    }

    result += linkifyPlainText(value.slice(lastIndex), sessionId)
    return result
}

function linkifyPathOnlyCodeContent(content: string, sessionId: string): string {
    return splitLinesWithEndings(content)
        .map((line) => linkifyInlineCodeAwareText(line, sessionId))
        .join('')
}

function linkifyTextWithFencedBlocks(value: string, sessionId: string): string {
    const lines = splitLinesWithEndings(value)
    let result = ''

    for (let index = 0; index < lines.length;) {
        const line = lines[index]
        const fenceStart = line.match(/^([ \t]*)(`{3,}|~{3,})[^\n]*(?:\n)?$/)

        if (!fenceStart) {
            result += linkifyInlineCodeAwareText(line, sessionId)
            index += 1
            continue
        }

        const fenceMarker = fenceStart[2]
        const fenceChar = fenceMarker[0]
        const minimumFenceLength = fenceMarker.length
        const fenceCloseRegex = new RegExp(`^[ \\t]*\\${fenceChar}{${minimumFenceLength},}[ \\t]*(?:\\n)?$`)
        const blockLines = [line]
        const contentLines: string[] = []
        let closed = false
        index += 1

        while (index < lines.length) {
            const blockLine = lines[index]
            blockLines.push(blockLine)
            index += 1

            if (fenceCloseRegex.test(blockLine)) {
                closed = true
                break
            }
            contentLines.push(blockLine)
        }

        const content = contentLines.join('')
        result += closed && isPathOnlyCodeContent(content)
            ? linkifyPathOnlyCodeContent(content, sessionId)
            : blockLines.join('')
    }

    return result
}

export function linkAssistantFilePaths(text: string, sessionId: string): string {
    if (!text || !sessionId) return text
    return linkifyTextWithFencedBlocks(text, sessionId)
}
