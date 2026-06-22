import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { StoredSessionShare } from './types'

type DbSessionShareRow = {
    id: string
    namespace: string
    session_id: string
    token_hash: string
    token_encrypted: string
    password_hash: string
    label: string | null
    visible_from_seq: number
    expires_at: number | null
    revoked_at: number | null
    created_at: number
    updated_at: number
    last_used_at: number | null
}

type CreateShareInput = {
    namespace: string
    sessionId: string
    tokenHash: string
    tokenEncrypted: string
    passwordHash: string
    label?: string | null
    visibleFromSeq: number
    expiresAt?: number | null
}

type UpdateShareInput = {
    label?: string | null
    passwordHash?: string
    expiresAt?: number | null
}

function toStoredSessionShare(row: DbSessionShareRow): StoredSessionShare {
    return {
        id: row.id,
        namespace: row.namespace,
        sessionId: row.session_id,
        tokenHash: row.token_hash,
        tokenEncrypted: row.token_encrypted,
        passwordHash: row.password_hash,
        label: row.label,
        visibleFromSeq: row.visible_from_seq,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at
    }
}

function isActiveWhere(now: number): string {
    return `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${Math.floor(now)})`
}

export function createSessionShare(db: Database, input: CreateShareInput, now: number = Date.now()): StoredSessionShare {
    const id = randomUUID()
    db.prepare(`
        INSERT INTO session_shares (
            id, namespace, session_id, token_hash, token_encrypted, password_hash,
            label, visible_from_seq, expires_at, revoked_at, created_at, updated_at, last_used_at
        ) VALUES (
            @id, @namespace, @session_id, @token_hash, @token_encrypted, @password_hash,
            @label, @visible_from_seq, @expires_at, NULL, @created_at, @updated_at, NULL
        )
    `).run({
        id,
        namespace: input.namespace,
        session_id: input.sessionId,
        token_hash: input.tokenHash,
        token_encrypted: input.tokenEncrypted,
        password_hash: input.passwordHash,
        label: input.label ?? null,
        visible_from_seq: Math.max(0, Math.floor(input.visibleFromSeq)),
        expires_at: input.expiresAt ?? null,
        created_at: now,
        updated_at: now
    })

    const row = getSessionShare(db, id, input.namespace)
    if (!row) {
        throw new Error('Failed to create session share')
    }
    return row
}

export function getSessionShare(db: Database, id: string, namespace: string): StoredSessionShare | null {
    const row = db.prepare('SELECT * FROM session_shares WHERE id = ? AND namespace = ?')
        .get(id, namespace) as DbSessionShareRow | undefined
    return row ? toStoredSessionShare(row) : null
}

export function getSessionShareByTokenHash(db: Database, tokenHash: string): StoredSessionShare | null {
    const row = db.prepare('SELECT * FROM session_shares WHERE token_hash = ?')
        .get(tokenHash) as DbSessionShareRow | undefined
    return row ? toStoredSessionShare(row) : null
}

export function listSessionShares(db: Database, namespace: string, sessionId: string): StoredSessionShare[] {
    const rows = db.prepare(`
        SELECT * FROM session_shares
        WHERE namespace = ? AND session_id = ?
        ORDER BY created_at DESC
    `).all(namespace, sessionId) as DbSessionShareRow[]
    return rows.map(toStoredSessionShare)
}

export function updateSessionShare(
    db: Database,
    namespace: string,
    sessionId: string,
    shareId: string,
    input: UpdateShareInput,
    now: number = Date.now()
): StoredSessionShare | null {
    const current = getSessionShare(db, shareId, namespace)
    if (!current || current.sessionId !== sessionId) {
        return null
    }

    db.prepare(`
        UPDATE session_shares
        SET label = @label,
            password_hash = @password_hash,
            expires_at = @expires_at,
            updated_at = @updated_at
        WHERE id = @id AND namespace = @namespace AND session_id = @session_id
    `).run({
        id: shareId,
        namespace,
        session_id: sessionId,
        label: input.label !== undefined ? input.label : current.label,
        password_hash: input.passwordHash !== undefined ? input.passwordHash : current.passwordHash,
        expires_at: input.expiresAt !== undefined ? input.expiresAt : current.expiresAt,
        updated_at: now
    })

    return getSessionShare(db, shareId, namespace)
}

export function revokeSessionShare(
    db: Database,
    namespace: string,
    sessionId: string,
    shareId: string,
    now: number = Date.now()
): StoredSessionShare | null {
    db.prepare(`
        UPDATE session_shares
        SET revoked_at = COALESCE(revoked_at, @now), updated_at = @now
        WHERE id = @id AND namespace = @namespace AND session_id = @session_id
    `).run({ id: shareId, namespace, session_id: sessionId, now })
    return getSessionShare(db, shareId, namespace)
}

export function touchSessionShareLastUsed(db: Database, id: string, now: number = Date.now()): void {
    db.prepare('UPDATE session_shares SET last_used_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id)
}

export function countActiveSessionSharesBySessionIds(
    db: Database,
    namespace: string,
    sessionIds: string[],
    now: number = Date.now()
): Record<string, number> {
    if (sessionIds.length === 0) {
        return {}
    }
    const placeholders = sessionIds.map(() => '?').join(', ')
    const rows = db.prepare(`
        SELECT session_id AS sessionId, COUNT(*) AS count
        FROM session_shares
        WHERE namespace = ?
          AND session_id IN (${placeholders})
          AND ${isActiveWhere(now)}
        GROUP BY session_id
    `).all(namespace, ...sessionIds) as Array<{ sessionId: string; count: number }>
    return Object.fromEntries(rows.map((row) => [row.sessionId, row.count]))
}
