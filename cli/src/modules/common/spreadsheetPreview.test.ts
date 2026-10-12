import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadSheet } = vi.hoisted(() => ({
    mockReadSheet: vi.fn()
}))

vi.mock('read-excel-file/node', () => ({
    readSheet: mockReadSheet
}))

import { parseSpreadsheetRange, readSpreadsheetRange } from './spreadsheetPreview'

describe('spreadsheet preview ranges', () => {
    beforeEach(() => {
        mockReadSheet.mockReset()
    })

    it('parses a rectangular A1 range', () => {
        expect(parseSpreadsheetRange('B1:X106')).toEqual({
            startRow: 1,
            startColumn: 2,
            endRow: 106,
            endColumn: 24
        })
    })

    it('accepts absolute cell references and single cells', () => {
        expect(parseSpreadsheetRange('$C$4')).toEqual({
            startRow: 4,
            startColumn: 3,
            endRow: 4,
            endColumn: 3
        })
    })

    it('rejects malformed or reversed ranges', () => {
        expect(parseSpreadsheetRange('B2:A1')).toBeNull()
        expect(parseSpreadsheetRange('not-a-range')).toBeNull()
    })

    it('projects only the requested bounded cells', async () => {
        mockReadSheet.mockResolvedValue([
            [null, 'B1', 'C1'],
            [null, 'B2', 'C2'],
        ])

        await expect(readSpreadsheetRange('/tmp/report.xlsx', '汇总表', 'B1:C2')).resolves.toEqual({
            sheet: '汇总表',
            range: 'B1:C2',
            startRow: 1,
            startColumn: 2,
            data: [['B1', 'C1'], ['B2', 'C2']],
            truncated: false
        })
        expect(mockReadSheet).toHaveBeenCalledWith('/tmp/report.xlsx', '汇总表')
    })
})
