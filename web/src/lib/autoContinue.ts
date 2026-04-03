import type { ChatBlock } from '@/chat/types'

export const AUTO_CONTINUE_DEFAULT_REMAINING = 20
export const AUTO_CONTINUE_LINE_LIMIT = 10
export const AUTO_CONTINUE_DEFAULT_KEYWORDS = ['下一步', '下一个步骤', 'next step', 'what next']

export type AutoContinueState = {
    enabled: boolean
    remaining: number
    maxRuns: number
    keywords: string[]
}

function getStorageKey(sessionId: string): string {
    return `hapi:auto-continue:${sessionId}`
}

function clampCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return AUTO_CONTINUE_DEFAULT_REMAINING
    }
    return Math.max(1, Math.floor(value))
}

function clampRemaining(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback
    }
    return Math.max(0, Math.floor(value))
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

export function loadAutoContinueState(sessionId: string): AutoContinueState {
    if (typeof window === 'undefined') {
        return {
            enabled: false,
            remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
            maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
            keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS]
        }
    }

    try {
        const raw = window.localStorage.getItem(getStorageKey(sessionId))
        if (!raw) {
            return {
                enabled: false,
                remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
                maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
                keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS]
            }
        }

        const parsed = JSON.parse(raw) as Partial<AutoContinueState>
        const maxRuns = clampCount(parsed.maxRuns)
        return {
            enabled: parsed.enabled === true,
            remaining: clampRemaining(parsed.remaining, maxRuns),
            maxRuns,
            keywords: normalizeAutoContinueKeywords(parsed.keywords)
        }
    } catch {
        return {
            enabled: false,
            remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
            maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
            keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS]
        }
    }
}

export function saveAutoContinueState(sessionId: string, state: AutoContinueState): void {
    if (typeof window === 'undefined') return

    const maxRuns = clampCount(state.maxRuns)

    try {
        window.localStorage.setItem(getStorageKey(sessionId), JSON.stringify({
            enabled: state.enabled,
            remaining: clampRemaining(state.remaining, maxRuns),
            maxRuns,
            keywords: normalizeAutoContinueKeywords(state.keywords)
        }))
    } catch {
    }
}

function collectTrailingAssistantLines(blocks: ChatBlock[], lines: string[]): boolean {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index]

        if (block.kind === 'user-text') {
            return true
        }

        if (block.kind === 'tool-call') {
            const reachedBoundary = collectTrailingAssistantLines(block.children, lines)
            if (reachedBoundary) {
                return true
            }
            continue
        }

        if (block.kind === 'agent-text' || block.kind === 'agent-reasoning' || block.kind === 'cli-output') {
            const nextLines = block.text
                .split(/\r?\n/g)
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .reverse()
            lines.push(...nextLines)
        }
    }

    return false
}

export function getLastAssistantLines(blocks: ChatBlock[], limit = AUTO_CONTINUE_LINE_LIMIT): string[] {
    const reversedLines: string[] = []
    collectTrailingAssistantLines(blocks, reversedLines)
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
