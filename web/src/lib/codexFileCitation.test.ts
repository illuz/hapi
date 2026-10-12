import { describe, expect, it } from 'vitest'
import {
    decodeCodexFileCitationHref,
    encodeCodexFileCitationHref,
    getCodexFileCitationLabel,
    parseCodexFileCitation,
} from './codexFileCitation'

describe('codex file citations', () => {
    const citation = {
        path: '/Users/hanzheng/github/51cloud-gongjing/docs/台账需求/总表（国有老难企业）.xlsx',
        purpose: 'source',
        artifactKind: 'workbook',
        sheet: '汇总表',
        range: 'B1:X106'
    }

    it('parses quoted citation attributes', () => {
        expect(parseCodexFileCitation(
            'path="/tmp/报告.xlsx" purpose="source" artifact_kind="workbook" sheet="汇总表" range="B1:X106"'
        )).toEqual({
            path: '/tmp/报告.xlsx',
            purpose: 'source',
            artifactKind: 'workbook',
            sheet: '汇总表',
            range: 'B1:X106'
        })
    })

    it('round-trips citation href payloads', () => {
        expect(decodeCodexFileCitationHref(encodeCodexFileCitationHref(citation))).toEqual(citation)
        expect(getCodexFileCitationLabel(citation)).toBe('总表（国有老难企业）.xlsx · 汇总表 · B1:X106')
    })

})
