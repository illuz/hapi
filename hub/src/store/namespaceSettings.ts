import type { Database } from 'bun:sqlite'

export type NamespaceSettings = {
    namespace: string
    autoRetryEnabled: boolean
    updatedAt: number
}

type DbNamespaceSettingsRow = {
    namespace: string
    auto_retry_enabled: number
    updated_at: number
}

function hasLegacyAutoRetryEnabled(metadata: unknown): boolean {
    if (typeof metadata !== 'string' || metadata.length === 0) {
        return false
    }

    try {
        const parsed = JSON.parse(metadata) as {
            autoContinue?: { retryOnOverload?: unknown }
        }
        return parsed.autoContinue?.retryOnOverload === true
    } catch {
        return false
    }
}

function toNamespaceSettings(row: DbNamespaceSettingsRow): NamespaceSettings {
    return {
        namespace: row.namespace,
        autoRetryEnabled: row.auto_retry_enabled === 1,
        updatedAt: row.updated_at
    }
}

/** Namespace-wide preferences shared by every session owned by that namespace. */
export class NamespaceSettingsStore {
    constructor(private readonly db: Database) {
    }

    get(namespace: string): NamespaceSettings {
        const existing = this.db.prepare(`
            SELECT namespace, auto_retry_enabled, updated_at
            FROM namespace_settings
            WHERE namespace = ?
        `).get(namespace) as DbNamespaceSettingsRow | undefined
        if (existing) {
            return toNamespaceSettings(existing)
        }

        // Preserve the previous per-session AUTO choice once during migration:
        // if any session had it enabled, the namespace-wide switch starts on.
        const legacySessions = this.db.prepare(`
            SELECT metadata
            FROM sessions
            WHERE namespace = ? AND metadata IS NOT NULL
        `).all(namespace) as Array<{ metadata: unknown }>
        const autoRetryEnabled = legacySessions.some((session) => (
            hasLegacyAutoRetryEnabled(session.metadata)
        ))

        return this.setAutoRetryEnabled(namespace, autoRetryEnabled)
    }

    setAutoRetryEnabled(namespace: string, enabled: boolean): NamespaceSettings {
        const updatedAt = Date.now()
        this.db.prepare(`
            INSERT INTO namespace_settings (namespace, auto_retry_enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(namespace) DO UPDATE SET
                auto_retry_enabled = excluded.auto_retry_enabled,
                updated_at = excluded.updated_at
        `).run(namespace, enabled ? 1 : 0, updatedAt)

        return {
            namespace,
            autoRetryEnabled: enabled,
            updatedAt
        }
    }
}
