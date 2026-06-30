const DEFAULT_EXPAND_TRIGGER_LINES = 3
const COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY = 'hapi-composer-max-rows'
const DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS = 5
const MIN_COLLAPSED_COMPOSER_MAX_ROWS = 4
const MAX_COLLAPSED_COMPOSER_MAX_ROWS = 12
const DEFAULT_RESIZE_PIXELS_PER_ROW = 24

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null

    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return

    try {
        window.localStorage.setItem(key, value)
    } catch {
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return

    try {
        window.localStorage.removeItem(key)
    } catch {
    }
}

export function measureComposerVisualLines(opts: {
    scrollHeight: number
    lineHeight: number
    paddingTop?: number
    paddingBottom?: number
}): number {
    const lineHeight = Number.isFinite(opts.lineHeight) && opts.lineHeight > 0
        ? opts.lineHeight
        : 20
    const paddingTop = typeof opts.paddingTop === 'number' && Number.isFinite(opts.paddingTop)
        ? opts.paddingTop
        : 0
    const paddingBottom = typeof opts.paddingBottom === 'number' && Number.isFinite(opts.paddingBottom)
        ? opts.paddingBottom
        : 0
    const contentHeight = Math.max(opts.scrollHeight - paddingTop - paddingBottom, lineHeight)

    return Math.max(1, Math.ceil(contentHeight / lineHeight))
}

export function shouldShowExpandedComposerTrigger(
    text: string,
    visualLineCount: number,
    minVisibleLines = DEFAULT_EXPAND_TRIGGER_LINES
): boolean {
    return text.trim().length > 0 && visualLineCount >= minVisibleLines
}

export function shouldShowCollapsedComposerResize(
    text: string,
    visualLineCount: number,
    maxRows: number
): boolean {
    return text.trim().length > 0 && visualLineCount > maxRows
}

export function clampCollapsedComposerMaxRows(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS
    }

    return Math.min(MAX_COLLAPSED_COMPOSER_MAX_ROWS, Math.max(MIN_COLLAPSED_COMPOSER_MAX_ROWS, Math.round(value)))
}

export function getInitialCollapsedComposerMaxRows(): number {
    return clampCollapsedComposerMaxRows(Number(safeGetItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)))
}

export function saveCollapsedComposerMaxRows(value: number): void {
    const nextValue = clampCollapsedComposerMaxRows(value)

    if (nextValue === DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS) {
        safeRemoveItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)
        return
    }

    safeSetItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY, String(nextValue))
}

export function getCollapsedComposerMaxRowsFromDelta(opts: {
    startRows: number
    deltaY: number
    pixelsPerRow?: number
}): number {
    const pixelsPerRow = Number.isFinite(opts.pixelsPerRow) && (opts.pixelsPerRow ?? 0) > 0
        ? opts.pixelsPerRow ?? DEFAULT_RESIZE_PIXELS_PER_ROW
        : DEFAULT_RESIZE_PIXELS_PER_ROW
    const deltaRows = Math.round((-opts.deltaY) / pixelsPerRow)

    return clampCollapsedComposerMaxRows(opts.startRows + deltaRows)
}

export {
    COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY,
    DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS,
    DEFAULT_EXPAND_TRIGGER_LINES,
    MAX_COLLAPSED_COMPOSER_MAX_ROWS,
    MIN_COLLAPSED_COMPOSER_MAX_ROWS,
    safeRemoveItem
}
