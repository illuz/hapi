import type { Database } from 'bun:sqlite'

import type { StoredCustomCodexModel } from './types'

type DbCustomCodexModelRow = {
    namespace: string
    model_id: string
    display_name: string | null
    supported_reasoning_efforts: string | null
    created_at: number
    updated_at: number
}

export type CustomCodexModelInput = {
    modelId: string
    displayName?: string | null
    supportedReasoningEfforts?: string[]
}

function parseReasoningEfforts(raw: string | null): string[] {
    if (!raw) {
        return []
    }

    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
            return []
        }

        return Array.from(new Set(
            parsed.filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim())
                .filter(Boolean)
        ))
    } catch {
        return []
    }
}

function normalizeReasoningEfforts(values: string[] | undefined): string[] {
    return Array.from(new Set(
        (values ?? [])
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
    ))
}

function toStoredCustomCodexModel(row: DbCustomCodexModelRow): StoredCustomCodexModel {
    return {
        namespace: row.namespace,
        modelId: row.model_id,
        displayName: row.display_name,
        supportedReasoningEfforts: parseReasoningEfforts(row.supported_reasoning_efforts),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

export class CustomCodexModelStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    list(namespace: string): StoredCustomCodexModel[] {
        const rows = this.db.prepare(`
            SELECT namespace, model_id, display_name, supported_reasoning_efforts, created_at, updated_at
            FROM custom_codex_models
            WHERE namespace = ?
            ORDER BY created_at ASC, model_id ASC
        `).all(namespace) as DbCustomCodexModelRow[]
        return rows.map(toStoredCustomCodexModel)
    }

    upsert(namespace: string, input: CustomCodexModelInput): StoredCustomCodexModel {
        const modelId = input.modelId.trim()
        if (!modelId) {
            throw new Error('Model ID is required')
        }

        const now = Date.now()
        const displayName = input.displayName?.trim() || null
        const supportedReasoningEfforts = normalizeReasoningEfforts(input.supportedReasoningEfforts)

        this.db.prepare(`
            INSERT INTO custom_codex_models (
                namespace, model_id, display_name, supported_reasoning_efforts, created_at, updated_at
            ) VALUES (
                @namespace, @model_id, @display_name, @supported_reasoning_efforts, @created_at, @updated_at
            )
            ON CONFLICT(namespace, model_id) DO UPDATE SET
                display_name = excluded.display_name,
                supported_reasoning_efforts = excluded.supported_reasoning_efforts,
                updated_at = excluded.updated_at
        `).run({
            namespace,
            model_id: modelId,
            display_name: displayName,
            supported_reasoning_efforts: supportedReasoningEfforts.length > 0
                ? JSON.stringify(supportedReasoningEfforts)
                : null,
            created_at: now,
            updated_at: now
        })

        const row = this.db.prepare(`
            SELECT namespace, model_id, display_name, supported_reasoning_efforts, created_at, updated_at
            FROM custom_codex_models
            WHERE namespace = ? AND model_id = ?
        `).get(namespace, modelId) as DbCustomCodexModelRow | undefined
        if (!row) {
            throw new Error('Failed to save custom Codex model')
        }
        return toStoredCustomCodexModel(row)
    }

    remove(namespace: string, modelId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM custom_codex_models WHERE namespace = ? AND model_id = ?'
        ).run(namespace, modelId.trim())
        return result.changes > 0
    }
}
