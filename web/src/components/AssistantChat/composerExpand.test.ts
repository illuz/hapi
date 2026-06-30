import { beforeEach, describe, expect, it } from 'vitest'
import {
    clampCollapsedComposerMaxRows,
    COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY,
    DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS,
    DEFAULT_EXPAND_TRIGGER_LINES,
    getCollapsedComposerMaxRowsFromDelta,
    getInitialCollapsedComposerMaxRows,
    MAX_COLLAPSED_COMPOSER_MAX_ROWS,
    measureComposerVisualLines,
    MIN_COLLAPSED_COMPOSER_MAX_ROWS,
    saveCollapsedComposerMaxRows,
    safeRemoveItem,
    shouldShowCollapsedComposerResize,
    shouldShowExpandedComposerTrigger
} from './composerExpand'

beforeEach(() => {
    window.localStorage.clear()
})

describe('measureComposerVisualLines', () => {
    it('returns at least one line for empty height', () => {
        expect(measureComposerVisualLines({
            scrollHeight: 0,
            lineHeight: 24,
            paddingTop: 0,
            paddingBottom: 0
        })).toBe(1)
    })

    it('removes vertical padding before computing line count', () => {
        expect(measureComposerVisualLines({
            scrollHeight: 92,
            lineHeight: 24,
            paddingTop: 10,
            paddingBottom: 10
        })).toBe(3)
    })

    it('falls back to a sane line height when measurement is invalid', () => {
        expect(measureComposerVisualLines({
            scrollHeight: 45,
            lineHeight: Number.NaN,
            paddingTop: 0,
            paddingBottom: 0
        })).toBe(3)
    })
})

describe('shouldShowExpandedComposerTrigger', () => {
    it('requires non-whitespace text', () => {
        expect(shouldShowExpandedComposerTrigger('   ', DEFAULT_EXPAND_TRIGGER_LINES)).toBe(false)
    })

    it('shows once the line threshold is reached', () => {
        expect(shouldShowExpandedComposerTrigger('line 1\nline 2\nline 3', DEFAULT_EXPAND_TRIGGER_LINES)).toBe(true)
    })

    it('stays hidden below the threshold', () => {
        expect(shouldShowExpandedComposerTrigger('line 1\nline 2', DEFAULT_EXPAND_TRIGGER_LINES - 1)).toBe(false)
    })
})

describe('shouldShowCollapsedComposerResize', () => {
    it('only shows when text exists and content exceeds collapsed max rows', () => {
        expect(shouldShowCollapsedComposerResize('', 6, 5)).toBe(false)
        expect(shouldShowCollapsedComposerResize('hello', 5, 5)).toBe(false)
        expect(shouldShowCollapsedComposerResize('hello', 6, 5)).toBe(true)
    })
})

describe('collapsed composer max rows helpers', () => {
    it('clamps row values into the supported range', () => {
        expect(clampCollapsedComposerMaxRows(MIN_COLLAPSED_COMPOSER_MAX_ROWS - 2)).toBe(MIN_COLLAPSED_COMPOSER_MAX_ROWS)
        expect(clampCollapsedComposerMaxRows(MAX_COLLAPSED_COMPOSER_MAX_ROWS + 3)).toBe(MAX_COLLAPSED_COMPOSER_MAX_ROWS)
        expect(clampCollapsedComposerMaxRows(9)).toBe(9)
    })

    it('loads the stored row count and falls back for invalid values', () => {
        window.localStorage.setItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY, '11')
        expect(getInitialCollapsedComposerMaxRows()).toBe(11)

        window.localStorage.setItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY, 'oops')
        expect(getInitialCollapsedComposerMaxRows()).toBe(DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS)
    })

    it('persists non-default values and clears the default value', () => {
        saveCollapsedComposerMaxRows(12)
        expect(window.localStorage.getItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)).toBe('12')

        saveCollapsedComposerMaxRows(DEFAULT_COLLAPSED_COMPOSER_MAX_ROWS)
        expect(window.localStorage.getItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)).toBeNull()
    })

    it('can clear the remembered value explicitly', () => {
        saveCollapsedComposerMaxRows(10)
        expect(window.localStorage.getItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)).toBe('10')

        safeRemoveItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)
        expect(window.localStorage.getItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)).toBeNull()
    })

    it('converts drag delta into row changes', () => {
        expect(getCollapsedComposerMaxRowsFromDelta({
            startRows: 8,
            deltaY: -50,
            pixelsPerRow: 25
        })).toBe(10)

        expect(getCollapsedComposerMaxRowsFromDelta({
            startRows: 8,
            deltaY: 52,
            pixelsPerRow: 26
        })).toBe(6)
    })
})
