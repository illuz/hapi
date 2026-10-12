import { parseCodexDirective } from './codexDirectives'

export type CodexFileCitation = {
    path: string
    purpose?: string
    artifactKind?: string
    sheet?: string
    range?: string
    pageNumber?: string
    slideNumber?: string
    lineRangeStart?: string
    lineRangeEnd?: string
    label?: string
}

export const CODEX_FILE_CITATION_HREF_PREFIX = 'hapi-codex-file:'

export function citationFromAttributes(attributes: Record<string, string>): CodexFileCitation | null {
    if (!attributes.path?.trim()) return null
    return {
        path: attributes.path,
        purpose: attributes.purpose,
        artifactKind: attributes.artifact_kind,
        sheet: attributes.sheet,
        range: attributes.range,
        pageNumber: attributes.page_number,
        slideNumber: attributes.slide_number,
        lineRangeStart: attributes.line_range_start,
        lineRangeEnd: attributes.line_range_end,
        label: attributes.label,
    }
}

export function parseCodexFileCitation(value: string): CodexFileCitation | null {
    const source = ':codex-file-citation{' + value + '}'
    const directive = parseCodexDirective(source)
    return directive?.raw.length === source.length ? citationFromAttributes(directive.attributes) : null
}

export function getCodexFileCitationLabel(citation: CodexFileCitation): string {
    const fileName = citation.path.replace(/\\/g, '/').split('/').pop() || citation.path
    const lineRange = citation.lineRangeStart
        ? 'L' + citation.lineRangeStart + (citation.lineRangeEnd ? '–L' + citation.lineRangeEnd : '')
        : undefined
    const details = [
        citation.sheet, citation.range,
        citation.pageNumber ? 'p. ' + citation.pageNumber : undefined,
        citation.slideNumber ? 'slide ' + citation.slideNumber : undefined,
        lineRange, citation.label,
    ].filter(Boolean).join(' · ')
    return details ? `${fileName} · ${details}` : fileName
}

export function encodeCodexFileCitationHref(citation: CodexFileCitation): string {
    return `${CODEX_FILE_CITATION_HREF_PREFIX}${encodeURIComponent(JSON.stringify(citation))}`
}

export function decodeCodexFileCitationHref(href: string | undefined): CodexFileCitation | null {
    if (!href?.startsWith(CODEX_FILE_CITATION_HREF_PREFIX)) return null

    try {
        const value: unknown = JSON.parse(decodeURIComponent(href.slice(CODEX_FILE_CITATION_HREF_PREFIX.length)))
        if (!value || typeof value !== 'object') return null
        const citation = value as Partial<CodexFileCitation>
        if (typeof citation.path !== 'string' || !citation.path) return null
        return {
            path: citation.path,
            purpose: typeof citation.purpose === 'string' ? citation.purpose : undefined,
            artifactKind: typeof citation.artifactKind === 'string' ? citation.artifactKind : undefined,
            sheet: typeof citation.sheet === 'string' ? citation.sheet : undefined,
            range: typeof citation.range === 'string' ? citation.range : undefined,
            pageNumber: typeof citation.pageNumber === 'string' ? citation.pageNumber : undefined,
            slideNumber: typeof citation.slideNumber === 'string' ? citation.slideNumber : undefined,
            lineRangeStart: typeof citation.lineRangeStart === 'string' ? citation.lineRangeStart : undefined,
            lineRangeEnd: typeof citation.lineRangeEnd === 'string' ? citation.lineRangeEnd : undefined,
            label: typeof citation.label === 'string' ? citation.label : undefined
        }
    } catch {
        return null
    }
}
