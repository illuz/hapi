import { describe, expect, it } from 'vitest'
import {
    CODEX_DIRECTIVE_HREF_PREFIX,
    decodeCodexDirectiveHref,
    encodeCodexDirectiveHref,
    isSupportedCodexDirective,
    parseCodexDirective,
} from './codexDirectives'

describe('Codex directive protocol', () => {
    it('parses inline followups with literal Markdown, braces and escaped quotes', () => {
        const parsed = parseCodexDirective(String.raw`:codex-followup[合并应用清单]{prompt="输出 {\"a\":1}，读取 **报告** 和 C:\temp\a.csv。"} suffix`)
        expect(parsed).toMatchObject({
            name: 'codex-followup', label: '合并应用清单',
            attributes: { prompt: String.raw`输出 {"a":1}，读取 **报告** 和 C:\temp\a.csv。` },
        })
        expect(parsed?.raw.endsWith('}')).toBe(true)
    })

    it('supports block, unquoted numeric and multiline attributes', () => {
        expect(parseCodexDirective("::code-comment{title='Fix' body='First\nSecond' file='src/a.ts' start=2 priority=1}"))
            .toMatchObject({ attributes: { body: 'First\nSecond', start: '2', priority: '1' } })
        expect(parseCodexDirective(String.raw`::git-stage{cwd="C:\repo\"}`))
            .toMatchObject({ attributes: { cwd: 'C:\\repo\\' } })
    })

    it.each([
        ':codex-followup[未完成]{prompt="text',
        ':codex-followup[label]{prompt="a" prompt="b"}',
        '::inbox-item{title="Title", summary="Summary"}',
        '::inbox-item{title="Title" invalid}',
        '::::inbox-item{title="Title" summary="Summary"}',
        '::inbox-item{title="Title" summary="' + 'x'.repeat(33_000) + '"}',
    ])('rejects malformed or oversized directives: %.50s', (source) => {
        expect(parseCodexDirective(source)).toBeNull()
    })

    it('validates required fields, preserves unknown names for the caller', () => {
        const unknown = parseCodexDirective('::future-widget{title="Unknown"}')
        expect(unknown).not.toBeNull()
        expect(isSupportedCodexDirective(unknown!)).toBe(false)
        expect(isSupportedCodexDirective(parseCodexDirective(':codex-followup[label]{prompt=""}')!)).toBe(false)
        expect(isSupportedCodexDirective(parseCodexDirective('::code-comment{title="No body"}')!)).toBe(false)
    })

    it('round-trips and validates untrusted URL payloads', () => {
        const directive = { name: 'codex-followup', label: '继续', attributes: { prompt: '生成 CSV' } }
        expect(decodeCodexDirectiveHref(encodeCodexDirectiveHref(directive))).toEqual(directive)
        for (const payload of ['%zz', 'null', '[]', '{"name":"codex-followup","label":42,"attributes":{"prompt":"x"}}',
            '{"name":"codex-followup","label":"x","attributes":{"prompt":5}}']) {
            expect(decodeCodexDirectiveHref(CODEX_DIRECTIVE_HREF_PREFIX + payload)).toBeNull()
        }
        expect(decodeCodexDirectiveHref(encodeCodexDirectiveHref({ name: 'unknown', attributes: {} }))).toBeNull()
    })

    it('parses writing blocks without treating a fenced example as the closing fence', () => {
        const source = ':::writing{variant="email" id="12345" subject="主题"}\nDear team,\n\n~~~\n:::\n~~~\nThanks.\n:::\nAfter'
        const directive = parseCodexDirective(source)
        expect(directive?.body).toBe('Dear team,\n\n~~~\n:::\n~~~\nThanks.')
        expect(directive?.raw.endsWith('Thanks.\n:::')).toBe(true)
        expect(isSupportedCodexDirective(directive!)).toBe(true)
        expect(decodeCodexDirectiveHref(encodeCodexDirectiveHref(directive!))?.body).toBe(directive?.body)
        expect(parseCodexDirective(':::writing{variant="email" id="12345"}\nNo closing fence')).toBeNull()
        expect(parseCodexDirective(':::writing{variant="email" id="12345"} same line\nBody\n:::')).toBeNull()
    })
})
