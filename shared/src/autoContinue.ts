import { z } from 'zod'
import { unwrapRoleWrappedRecordEnvelope } from './messages'
import { isObject } from './utils'

export const AUTO_CONTINUE_DEFAULT_REMAINING = 20
export const AUTO_CONTINUE_DEFAULT_MESSAGE = 'continue'
export const AUTO_CONTINUE_LINE_LIMIT = 10
export const AUTO_CONTINUE_DEFAULT_KEYWORDS = ['下一步', '下一个步骤', 'next step', 'what next']

export const AutoContinueSettingsSchema = z.object({
    enabled: z.boolean(),
    remaining: z.number().int().min(0),
    maxRuns: z.number().int().min(1),
    keywords: z.array(z.string().trim().min(1)).min(1),
    messageText: z.string().trim().min(1)
})

export type AutoContinueSettings = z.infer<typeof AutoContinueSettingsSchema>

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
        messageText: normalizeAutoContinueMessageText(candidate.messageText)
    }
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
