import { readSheet } from 'read-excel-file/node'

export type SpreadsheetCellValue = string | number | boolean | null

export type SpreadsheetRangePreview = {
    sheet?: string
    range?: string
    startRow: number
    startColumn: number
    data: SpreadsheetCellValue[][]
    truncated: boolean
}

export type SpreadsheetCellRange = {
    startRow: number
    startColumn: number
    endRow: number
    endColumn: number
}

export const MAX_SPREADSHEET_PREVIEW_ROWS = 500
export const MAX_SPREADSHEET_PREVIEW_COLUMNS = 100

const MAX_EXCEL_ROWS = 1_048_576
const MAX_EXCEL_COLUMNS = 16_384

function columnLettersToNumber(value: string): number {
    let result = 0
    for (const character of value.toUpperCase()) {
        result = result * 26 + character.charCodeAt(0) - 64
    }
    return result
}

function parseCellReference(value: string): { row: number; column: number } | null {
    const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(value.trim())
    if (!match) return null

    const column = columnLettersToNumber(match[1])
    const row = Number(match[2])
    if (!Number.isSafeInteger(row) || row < 1 || row > MAX_EXCEL_ROWS) return null
    if (!Number.isSafeInteger(column) || column < 1 || column > MAX_EXCEL_COLUMNS) return null
    return { row, column }
}

export function parseSpreadsheetRange(value: string | undefined): SpreadsheetCellRange | null {
    if (!value) return null

    const parts = value.split(':')
    if (parts.length > 2) return null

    const start = parseCellReference(parts[0])
    const end = parseCellReference(parts[1] ?? parts[0])
    if (!start || !end) return null
    if (end.row < start.row || end.column < start.column) return null

    return {
        startRow: start.row,
        startColumn: start.column,
        endRow: end.row,
        endColumn: end.column
    }
}

function normalizeCell(value: unknown): SpreadsheetCellValue {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    return String(value)
}

function getVisibleRange(
    source: unknown[][],
    requested: SpreadsheetCellRange | null
): { range: SpreadsheetCellRange; truncated: boolean } {
    const sourceRows = source.length
    const sourceColumns = source.reduce((maximum, row) => Math.max(maximum, row.length), 0)
    if (!requested && (sourceRows === 0 || sourceColumns === 0)) {
        return {
            range: {
                startRow: 1,
                startColumn: 1,
                endRow: 0,
                endColumn: 0
            },
            truncated: false
        }
    }
    const startRow = requested?.startRow ?? 1
    const startColumn = requested?.startColumn ?? 1
    const requestedEndRow = requested?.endRow ?? Math.max(sourceRows, startRow)
    const requestedEndColumn = requested?.endColumn ?? Math.max(sourceColumns, startColumn)
    const requestedRows = Math.max(0, requestedEndRow - startRow + 1)
    const requestedColumns = Math.max(0, requestedEndColumn - startColumn + 1)
    const visibleEndRow = startRow + Math.min(requestedRows, MAX_SPREADSHEET_PREVIEW_ROWS) - 1
    const visibleEndColumn = startColumn + Math.min(requestedColumns, MAX_SPREADSHEET_PREVIEW_COLUMNS) - 1

    return {
        range: {
            startRow,
            startColumn,
            endRow: visibleEndRow,
            endColumn: visibleEndColumn
        },
        truncated: requestedRows > MAX_SPREADSHEET_PREVIEW_ROWS
            || requestedColumns > MAX_SPREADSHEET_PREVIEW_COLUMNS
            || (!requested && (sourceRows > MAX_SPREADSHEET_PREVIEW_ROWS || sourceColumns > MAX_SPREADSHEET_PREVIEW_COLUMNS))
    }
}

function projectRange(source: unknown[][], range: SpreadsheetCellRange): SpreadsheetCellValue[][] {
    const rows: SpreadsheetCellValue[][] = []
    const columnCount = range.endColumn - range.startColumn + 1

    for (let rowIndex = range.startRow - 1; rowIndex < range.endRow; rowIndex += 1) {
        const sourceRow = source[rowIndex] ?? []
        const row: SpreadsheetCellValue[] = []
        for (let columnIndex = range.startColumn - 1; columnIndex < range.endColumn; columnIndex += 1) {
            row.push(normalizeCell(sourceRow[columnIndex]))
        }
        while (row.length < columnCount) row.push(null)
        rows.push(row)
    }

    return rows
}

/**
 * 在 Runner 本地读取指定工作表，并返回有上限的单元格区域。
 * XLSX 原始字节不会离开 Runner，只把小型 JSON 投影回传给 Hub/Web。
 */
export async function readSpreadsheetRange(
    filePath: string,
    sheet: string | undefined,
    rangeValue: string | undefined
): Promise<SpreadsheetRangePreview> {
    const requestedRange = parseSpreadsheetRange(rangeValue)
    if (rangeValue && !requestedRange) {
        throw new Error('Invalid spreadsheet range')
    }

    const source = await readSheet(filePath, sheet) as unknown[][]
    const visible = getVisibleRange(source, requestedRange)
    return {
        sheet,
        range: rangeValue,
        startRow: visible.range.startRow,
        startColumn: visible.range.startColumn,
        data: projectRange(source, visible.range),
        truncated: visible.truncated
    }
}
