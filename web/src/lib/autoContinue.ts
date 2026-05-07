import type { ChatBlock } from '@/chat/types'

export const AUTO_CONTINUE_DEFAULT_REMAINING = 80
export const AUTO_CONTINUE_LINE_LIMIT = 10
export const AUTO_CONTINUE_DEFAULT_KEYWORDS = ['下一步', '下一个步骤', '下一轮', '继续', 'continue', 'next step', 'next\\s+\\w+\\s+step', 'what next']
export const AUTO_CONTINUE_DEFAULT_PROMPT = 'continue'

export type AutoContinueState = {
    enabled: boolean
    remaining: number
    maxRuns: number
    keywords: string[]
    prompt: string
}

type AutoContinueSharedSettings = Pick<AutoContinueState, 'keywords' | 'prompt'>

function getSessionStorageKey(sessionId: string): string {
    return `hapi:auto-continue:${sessionId}`
}

function getSharedStorageKey(): string {
    return 'hapi:auto-continue:shared'
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

export function normalizeAutoContinuePrompt(value: unknown): string {
    if (typeof value !== 'string') {
        return AUTO_CONTINUE_DEFAULT_PROMPT
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : AUTO_CONTINUE_DEFAULT_PROMPT
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

function getDefaultAutoContinueState(): AutoContinueState {
    return {
        enabled: false,
        remaining: AUTO_CONTINUE_DEFAULT_REMAINING,
        maxRuns: AUTO_CONTINUE_DEFAULT_REMAINING,
        keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS],
        prompt: AUTO_CONTINUE_DEFAULT_PROMPT
    }
}

function loadAutoContinueSharedSettings(): AutoContinueSharedSettings {
    if (typeof window === 'undefined') {
        return {
            keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS],
            prompt: AUTO_CONTINUE_DEFAULT_PROMPT
        }
    }

    try {
        const raw = window.localStorage.getItem(getSharedStorageKey())
        if (!raw) {
            return {
                keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS],
                prompt: AUTO_CONTINUE_DEFAULT_PROMPT
            }
        }

        const parsed = JSON.parse(raw) as Partial<AutoContinueSharedSettings>
        return {
            keywords: normalizeAutoContinueKeywords(parsed.keywords),
            prompt: normalizeAutoContinuePrompt(parsed.prompt)
        }
    } catch {
        return {
            keywords: [...AUTO_CONTINUE_DEFAULT_KEYWORDS],
            prompt: AUTO_CONTINUE_DEFAULT_PROMPT
        }
    }
}

export function loadAutoContinueState(sessionId: string): AutoContinueState {
    const defaults = getDefaultAutoContinueState()
    const sharedSettings = loadAutoContinueSharedSettings()

    if (typeof window === 'undefined') {
        return { ...defaults, ...sharedSettings }
    }

    try {
        const raw = window.localStorage.getItem(getSessionStorageKey(sessionId))
        if (!raw) {
            return { ...defaults, ...sharedSettings }
        }

        const parsed = JSON.parse(raw) as Partial<Pick<AutoContinueState, 'enabled' | 'remaining' | 'maxRuns'>>
        const maxRuns = clampCount(parsed.maxRuns)
        return {
            enabled: parsed.enabled === true,
            remaining: clampRemaining(parsed.remaining, maxRuns),
            maxRuns,
            keywords: sharedSettings.keywords,
            prompt: sharedSettings.prompt
        }
    } catch {
        return { ...defaults, ...sharedSettings }
    }
}

export function saveAutoContinueState(sessionId: string, state: AutoContinueState): void {
    if (typeof window === 'undefined') return

    const maxRuns = clampCount(state.maxRuns)

    try {
        window.localStorage.setItem(getSessionStorageKey(sessionId), JSON.stringify({
            enabled: state.enabled,
            remaining: clampRemaining(state.remaining, maxRuns),
            maxRuns
        }))
        window.localStorage.setItem(getSharedStorageKey(), JSON.stringify({
            keywords: normalizeAutoContinueKeywords(state.keywords),
            prompt: normalizeAutoContinuePrompt(state.prompt)
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

function compileAutoContinuePattern(keyword: string): RegExp | null {
    const normalizedKeyword = keyword.trim()
    if (normalizedKeyword.length === 0) return null

    if (normalizedKeyword.startsWith('/') && normalizedKeyword.lastIndexOf('/') > 0) {
        const lastSlashIndex = normalizedKeyword.lastIndexOf('/')
        const pattern = normalizedKeyword.slice(1, lastSlashIndex)
        const rawFlags = normalizedKeyword.slice(lastSlashIndex + 1)
        const flags = rawFlags.includes('i') ? rawFlags : `${rawFlags}i`

        try {
            return new RegExp(pattern, flags)
        } catch {
            return null
        }
    }

    if (!/[.*+?()[\]{}\\|]/.test(normalizedKeyword)) {
        return null
    }

    try {
        return new RegExp(normalizedKeyword, 'i')
    } catch {
        return null
    }
}

export function shouldAutoContinue(lines: string[], keywords = AUTO_CONTINUE_DEFAULT_KEYWORDS): boolean {
    if (lines.length === 0) return false
    const normalizedKeywords = normalizeAutoContinueKeywords(keywords)
    const loweredLines = lines.map((line) => line.toLowerCase())
    return normalizedKeywords.some((keyword) => {
        const pattern = compileAutoContinuePattern(keyword)
        if (pattern) {
            return lines.some((line) => pattern.test(line))
        }
        const loweredKeyword = keyword.toLowerCase()
        return loweredLines.some((line) => line.includes(loweredKeyword))
    })
}
