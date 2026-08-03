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
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const SOURCE_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/
const POSIX_SYSTEM_TEMP_PATH_PATTERN = /^\/(?:tmp|private\/tmp|var\/tmp|var\/folders\/[^/]+\/[^/]+\/T)(?:\/|$)/
const WINDOWS_SYSTEM_TEMP_PATH_PATTERN = /^[A-Za-z]:\/(?:Windows\/Temp|Users\/[^/]+\/AppData\/Local\/Temp)(?:\/|$)/i

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

function decodeHrefPath(value: string): string | null {
    try {
        return decodeURIComponent(value)
    } catch {
        return null
    }
}

function getLocalPathFromHref(href: string): string | null {
    const value = href.trim()
    if (!value || value.startsWith('#') || value.startsWith('?') || value.startsWith('//')) {
        return null
    }

    if (/^file:/i.test(value)) {
        try {
            const url = new URL(value)
            if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) {
                return null
            }

            const decodedPath = decodeHrefPath(url.pathname)
            if (!decodedPath) return null
            return /^\/[A-Za-z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath
        } catch {
            return null
        }
    }

    const pathBeforePosition = value.replace(SOURCE_POSITION_SUFFIX_PATTERN, '')
    const schemeCheckValue = pathBeforePosition.includes('.') ? pathBeforePosition : value
    if (!WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) && URI_SCHEME_PATTERN.test(schemeCheckValue)) {
        return null
    }

    const suffixIndex = value.search(/[?#]/)
    return decodeHrefPath(suffixIndex >= 0 ? value.slice(0, suffixIndex) : value)
}

function normalizeRelativeFilePath(value: string): string | null {
    const normalized = value.replace(/\\/g, '/')
    if (!normalized || normalized.startsWith('/') || normalized.startsWith('~/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized)) {
        return null
    }

    const segments: string[] = []
    for (const segment of normalized.split('/')) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (segments.length === 0) return null
            segments.pop()
            continue
        }
        segments.push(segment)
    }

    return segments.length > 0 ? segments.join('/') : null
}

function normalizeAbsoluteFilePath(value: string): string | null {
    const normalized = value.replace(/\\/g, '/')
    const driveMatch = /^([A-Za-z]:)\//.exec(normalized)
    const isPosixAbsolute = normalized.startsWith('/')
    if (!driveMatch && !isPosixAbsolute) return null

    const prefix = driveMatch ? `${driveMatch[1]}/` : '/'
    const remainder = driveMatch ? normalized.slice(driveMatch[0].length) : normalized.slice(1)
    const segments: string[] = []

    for (const segment of remainder.split('/')) {
        if (!segment || segment === '.') continue
        if (segment === '..') {
            if (segments.length === 0) return null
            segments.pop()
            continue
        }
        segments.push(segment)
    }

    return `${prefix}${segments.join('/')}`
}

function makeSessionRelativePath(filePath: string, workingDirectory: string | null | undefined): string | null {
    const normalizedFilePath = normalizeAbsoluteFilePath(filePath)
    if (!normalizedFilePath || !workingDirectory) return null

    const normalizedWorkingDirectory = normalizeAbsoluteFilePath(workingDirectory)
    if (!normalizedWorkingDirectory) return null

    const windowsPath = WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalizedFilePath)
    if (windowsPath !== WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalizedWorkingDirectory)) {
        return null
    }

    const comparableFilePath = windowsPath ? normalizedFilePath.toLowerCase() : normalizedFilePath
    const comparableWorkingDirectory = windowsPath ? normalizedWorkingDirectory.toLowerCase() : normalizedWorkingDirectory
    const workingDirectoryPrefix = comparableWorkingDirectory.endsWith('/')
        ? comparableWorkingDirectory
        : `${comparableWorkingDirectory}/`

    if (!comparableFilePath.startsWith(workingDirectoryPrefix)) return null
    return normalizedFilePath.slice(workingDirectoryPrefix.length) || null
}

function isSystemTemporaryPath(filePath: string): boolean {
    return POSIX_SYSTEM_TEMP_PATH_PATTERN.test(filePath)
        || WINDOWS_SYSTEM_TEMP_PATH_PATTERN.test(filePath)
}

export function resolveLocalFileHref(
    href: string | undefined,
    sessionId: string | undefined,
    workingDirectory?: string | null
): string | null {
    if (!href || !sessionId) return null

    const localPath = getLocalPathFromHref(href)
    if (!localPath) return null

    const pathWithoutPosition = localPath.replace(SOURCE_POSITION_SUFFIX_PATTERN, '')
    const absolutePath = normalizeAbsoluteFilePath(pathWithoutPosition)
    const previewPath = absolutePath
        ? isSystemTemporaryPath(absolutePath)
            ? absolutePath
            : makeSessionRelativePath(absolutePath, workingDirectory)
        : normalizeRelativeFilePath(pathWithoutPosition)

    return previewPath ? buildSessionFileHref(sessionId, previewPath) : null
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
