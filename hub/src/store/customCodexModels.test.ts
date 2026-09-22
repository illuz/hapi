import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from './index'

function dbOf(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

describe('CustomCodexModelStore', () => {
    it('stores and lists models per namespace', () => {
        const store = new Store(':memory:')

        const saved = store.customCodexModels.upsert('default', {
            modelId: ' gpt-6-astra ',
            displayName: 'GPT-6 Astra',
            supportedReasoningEfforts: ['high', ' ultra ', 'high']
        })

        expect(saved).toMatchObject({
            namespace: 'default',
            modelId: 'gpt-6-astra',
            displayName: 'GPT-6 Astra',
            supportedReasoningEfforts: ['high', 'ultra']
        })
        expect(store.customCodexModels.list('default')).toHaveLength(1)
        expect(store.customCodexModels.list('other')).toEqual([])
    })

    it('updates an existing model without duplicating it', () => {
        const store = new Store(':memory:')

        store.customCodexModels.upsert('default', { modelId: 'gpt-6-astra', displayName: 'Astra' })
        const updated = store.customCodexModels.upsert('default', {
            modelId: 'gpt-6-astra',
            displayName: 'GPT-6 Astra'
        })

        expect(updated.displayName).toBe('GPT-6 Astra')
        expect(store.customCodexModels.list('default')).toHaveLength(1)
    })

    it('removes only the requested namespace model', () => {
        const store = new Store(':memory:')

        store.customCodexModels.upsert('default', { modelId: 'gpt-6-astra' })
        store.customCodexModels.upsert('other', { modelId: 'gpt-6-astra' })

        expect(store.customCodexModels.remove('default', 'gpt-6-astra')).toBe(true)
        expect(store.customCodexModels.remove('default', 'gpt-6-astra')).toBe(false)
        expect(store.customCodexModels.list('other')).toHaveLength(1)
    })

    it('migrates a v17 database by creating the custom model table', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-custom-codex-model-migration-'))
        const dbPath = join(dir, 'test.db')

        try {
            const existing = new Store(dbPath)
            dbOf(existing).exec(`
                DROP TABLE custom_codex_models;
                PRAGMA user_version = 17;
            `)
            dbOf(existing).close()

            const migrated = new Store(dbPath)
            expect(migrated.customCodexModels.list('default')).toEqual([])

            const version = dbOf(migrated)
                .prepare('PRAGMA user_version')
                .get() as { user_version: number }
            expect(version.user_version).toBe(19)
            dbOf(migrated).close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
