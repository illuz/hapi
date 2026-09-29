import { describe, expect, it } from 'vitest'
import { getKaTeXFontAssets } from './katex-font-assets'

describe('KaTeX production font assets', () => {
    it('resolves the hoisted package and returns every supported font format', () => {
        const assets = getKaTeXFontAssets()
        const names = assets.map((asset) => asset.fileName)

        expect(names).toContain('assets/fonts/KaTeX_Main-Regular.woff2')
        expect(names).toContain('assets/fonts/KaTeX_Main-Regular.woff')
        expect(names).toContain('assets/fonts/KaTeX_Main-Regular.ttf')
        expect(assets.length).toBeGreaterThanOrEqual(60)
        expect(assets.every((asset) => asset.source.byteLength > 0)).toBe(true)
    })
})
