import { z } from 'zod'
import { unwrapRoleWrappedRecordEnvelope } from './messages'
import { isObject } from './utils'

export const AUTO_CONTINUE_DEFAULT_REMAINING = 20
export const AUTO_CONTINUE_DEFAULT_MESSAGE = 'continue'
export const AUTO_CONTINUE_LINE_LIMIT = 10
export const AUTO_CONTINUE_DEFAULT_KEYWORDS = ['下一步', '下一个步骤', 'next step', 'what next']
export const AUTO_RETRY_CONTINUE_DELAY_MS = 5_000

const AUTO_RETRYABLE_ERROR_PATTERNS = [
    'selected model is at capacity',
    'server is currently overloaded',
    'servers are currently overloaded',
    // Codex app-server omits the provider's original message for some
    // terminal thread failures and reports only this wrapper text.
    'codex thread entered systemerror'
] as const

const AUTO_RETRY_IN_PROGRESS_PATTERNS = [
    'retrying same conversation',
    'compacting same conversation before retry'
] as const

export const AutoContinueSettingsSchema = z.object({
    enabled: z.boolean(),
    remaining: z.number().int().min(0),
    maxRuns: z.number().int().min(1),
    keywords: z.array(z.string().trim().min(1)).min(1),
    messageText: z.string().trim().min(1),
    retryOnOverload: z.boolean().default(false)
})

export type AutoContinueSettings = z.infer<typeof AutoContinueSettingsSchema>

export type AutoRetryMessageDetails = {
    attempt: number | null
    maxAttempts: number | null
    inProgress: boolean
}

export function clampAutoContinueCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return AUTO_CONTINUE_DEFAULT_REMAINING
    }
    return Math.max(1, Math.floor(value))
}

export function clampAutoContinueRemaining(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback
    }
    return Math.max(0, Math.min(Math.floor(value), fallback))
}

export function normalizeAutoContinueKeywords(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [...AUTO_CONTINUE_DEFAULT_KEYWORDS]
    }

    const normalized = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)

    return normalized.length > 0 ? normalized : [...AUTO_CONTINUE_DEFAULT_KEYWORDS]
}

export function normalizeAutoContinueMessageText(value: unknown): string {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : AUTO_CONTINUE_DEFAULT_MESSAGE
}

export function normalizeAutoContinueSettings(value: unknown): AutoContinueSettings {
    const candidate = isObject(value) ? value : {}
    const maxRuns = clampAutoContinueCount(candidate.maxRuns)

    return {
        enabled: candidate.enabled === true,
        remaining: clampAutoContinueRemaining(candidate.remaining, maxRuns),
        maxRuns,
        keywords: normalizeAutoContinueKeywords(candidate.keywords),
        messageText: normalizeAutoContinueMessageText(candidate.messageText),
        retryOnOverload: candidate.retryOnOverload === true
    }
}

export function isAutoRetryableErrorMessage(message: string): boolean {
    const normalized = normalizeAutoRetryMessage(message)
    return AUTO_RETRYABLE_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))
}

export function isTerminalAutoRetryableErrorMessage(message: string): boolean {
    const details = parseAutoRetryMessage(message)
    return details !== null && !details.inProgress
}

/**
 * Extract the retry counter from a capacity/overload status message.
 *
 * The full provider error is intentionally not returned here.  Callers can
 * use `compactAutoRetryMessage` for a short history label while retaining the
 * original message for retry detection and diagnostics.
 */
export function parseAutoRetryMessage(message: string): AutoRetryMessageDetails | null {
    const normalized = normalizeAutoRetryMessage(message)
    if (!isAutoRetryableErrorMessage(normalized)) {
        return null
    }

    const isInProgress = AUTO_RETRY_IN_PROGRESS_PATTERNS.some((pattern) => normalized.includes(pattern))
    const attemptMatch = normalized.match(
        /(?:retrying same conversation|compacting same conversation before retry)\s*\((\d+)\s*\/\s*(\d+)\)/
    )
    const attempt = attemptMatch ? Number.parseInt(attemptMatch[1] ?? '', 10) : null
    const maxAttempts = attemptMatch ? Number.parseInt(attemptMatch[2] ?? '', 10) : null

    return {
        attempt: Number.isFinite(attempt) ? attempt : null,
        maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : null,
        inProgress: isInProgress
    }
}

/** Return a compact, provider-agnostic label for a retryable error. */
export function compactAutoRetryMessage(message: string): string | null {
    const details = parseAutoRetryMessage(message)
    if (!details) {
        // A few launchers emit a second, context-free `Task failed` line
        // after the provider-specific failure.  It is part of the same AUTO
        // recovery record, but it is not specific enough to drive a retry on
        // its own.
        return normalizeAutoRetryMessage(message) === 'task failed' ? 'AUTO retry failed' : null
    }

    if (details.inProgress && details.attempt !== null && details.maxAttempts !== null) {
        return `AUTO retry ${details.attempt}/${details.maxAttempts}`
    }

    if (details.inProgress) {
        return 'AUTO retrying'
    }

    return 'AUTO retry failed'
}

/** Compact retryable error lines inside a multi-line history excerpt. */
export function compactAutoRetryText(text: string): string {
    const lines = text.split(/\r?\n/g)
    if (!isAutoRetryableErrorMessage(text) && !lines.some((line) => compactAutoRetryMessage(line) !== null)) {
        return text
    }

    const compacted: string[] = []

    for (let index = 0; index < lines.length;) {
        const line = lines[index] ?? ''
        const direct = compactAutoRetryMessage(line)
        if (direct) {
            compacted.push(direct)
            index += 1
            continue
        }

        // Provider errors occasionally wrap the capacity phrase over a line
        // break.  Only start a multi-line match on an error-looking line so
        // surrounding history text (for example, a preceding paragraph) is
        // not swallowed by the compact marker.
        if (!isAutoRetryMessageLineStart(line)) {
            compacted.push(line)
            index += 1
            continue
        }

        let replaced = false
        const maxEnd = Math.min(lines.length, index + 12)
        for (let end = index + 2; end <= maxEnd; end += 1) {
            const candidate = lines.slice(index, end).join('\n')
            const compact = compactAutoRetryMessage(candidate)
            if (!compact) continue

            compacted.push(compact)
            index = end
            replaced = true
            break
        }

        if (!replaced) {
            compacted.push(line)
            index += 1
        }
    }

    return compacted.join('\n')
}

function isAutoRetryMessageLineStart(line: string): boolean {
    const normalized = normalizeAutoRetryMessage(line)
    return normalized.includes('task failed')
        || normalized.includes('selected model is at capacity')
        || normalized.includes('server is currently overloaded')
        || normalized.includes('servers are currently overloaded')
        || normalized.includes('our servers are currently')
}

function normalizeAutoRetryMessage(message: string): string {
    return message.trim().toLowerCase().replace(/\s+/g, ' ')
}

function extractStrings(value: unknown, output: string[]): void {
    if (typeof value === 'string') {
        output.push(value)
        return
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            extractStrings(item, output)
        }
        return
    }

    if (!isObject(value)) {
        return
    }

    if (typeof value.text === 'string') output.push(value.text)
    if (typeof value.thinking === 'string') output.push(value.thinking)
    if ('content' in value) extractStrings(value.content, output)
    if ('message' in value) extractStrings(value.message, output)
    if ('data' in value) extractStrings(value.data, output)
    if ('result' in value) extractStrings(value.result, output)
    if ('summary' in value && typeof value.summary === 'string') output.push(value.summary)
}

function collectTrailingAssistantLinesFromMessages(
    messages: Array<{ content: unknown }>,
    lines: string[]
): void {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const record = unwrapRoleWrappedRecordEnvelope(messages[index]?.content)
        if (!record) {
            continue
        }

        if (record.role === 'user') {
            return
        }

        if (record.role !== 'agent') {
            continue
        }

        const fragments: string[] = []
        extractStrings(record.content, fragments)

        const nextLines = fragments
            .flatMap((fragment) => fragment.split(/\r?\n/g))
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .reverse()

        lines.push(...nextLines)
    }
}

export function getLastAssistantLinesFromMessages(
    messages: Array<{ content: unknown }>,
    limit = AUTO_CONTINUE_LINE_LIMIT
): string[] {
    const reversedLines: string[] = []
    collectTrailingAssistantLinesFromMessages(messages, reversedLines)
    return reversedLines.slice(0, limit).reverse()
}

export function shouldAutoContinue(lines: string[], keywords = AUTO_CONTINUE_DEFAULT_KEYWORDS): boolean {
    if (lines.length === 0) return false
    const normalizedKeywords = normalizeAutoContinueKeywords(keywords)
    const loweredLines = lines.map((line) => line.toLowerCase())
    return normalizedKeywords.some((keyword) => {
        const loweredKeyword = keyword.toLowerCase()
        return loweredLines.some((line) => line.includes(loweredKeyword))
    })
}
