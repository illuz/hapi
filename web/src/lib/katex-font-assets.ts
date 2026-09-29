import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)

export type KaTeXFontAsset = {
    fileName: string
    source: Uint8Array
}

export function getKaTeXFontAssets(): KaTeXFontAsset[] {
    const fontsDir = resolve(require.resolve('katex'), '..', 'fonts')

    return readdirSync(fontsDir)
        .filter((fileName) => /\.(?:ttf|woff|woff2)$/i.test(fileName))
        .map((fileName) => ({
            fileName: `assets/fonts/${fileName}`,
            source: readFileSync(resolve(fontsDir, fileName))
        }))
}
