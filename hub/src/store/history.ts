import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type { SessionMarkerColor } from '@hapi/protocol/types'

import type { StoredHistoryEntry } from './types'

type DbHistoryRow = {
    id: string
    namespace: string
    session_id: string
    user_message_id: string | null
    assistant_message_id: string | null
    created_at: number
    title: string
    project_path: string | null
    project_host: string | null
    marker_color: string | null
    user_text: string
    assistant_excerpt: string
}

export type HistorySearchScope = 'session' | 'project' | 'all'

export type AddHistoryEntryInput = {
    namespace: string
    sessionId: string
    userMessageId?: string | null
    assistantMessageId?: string | null
    createdAt?: number
    title: string
    projectPath?: string | null
    projectHost?: string | null
    markerColor?: SessionMarkerColor | null
    userText: string
    assistantExcerpt: string
}

export type SearchHistoryOptions = {
    namespace: string
    scope: HistorySearchScope
    sessionId?: string | null
    projectPath?: string | null
    query?: string | null
    userOnly?: boolean
    limit?: number
    before?: { createdAt: number; id: string } | null
}

export type SearchHistoryResult = {
    entries: StoredHistoryEntry[]
    page: {
        limit: number
        nextBeforeCreatedAt: number | null
        nextBeforeId: string | null
        hasMore: boolean
    }
}

export type MergeHistoryEntriesResult = {
    moved: number
    duplicatesRemoved: number
}

function toStoredHistoryEntry(row: DbHistoryRow): StoredHistoryEntry {
    return {
        id: row.id,
        namespace: row.namespace,
        sessionId: row.session_id,
        userMessageId: row.user_message_id,
        assistantMessageId: row.assistant_message_id,
        createdAt: row.created_at,
        title: row.title,
        projectPath: row.project_path,
        projectHost: row.project_host,
        markerColor: row.marker_color as SessionMarkerColor | null,
        userText: row.user_text,
        assistantExcerpt: row.assistant_excerpt
    }
}

function normalizeLikeQuery(query: string | null | undefined): string | null {
    const trimmed = query?.trim()
    if (!trimmed) return null
    return `%${trimmed.toLowerCase().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

export function addHistoryEntry(db: Database, input: AddHistoryEntryInput): StoredHistoryEntry {
    const id = randomUUID()
    const createdAt = input.createdAt ?? Date.now()

    db.prepare(`
        INSERT OR IGNORE INTO conversation_history (
            id, namespace, session_id, user_message_id, assistant_message_id,
            created_at, title, project_path, project_host, marker_color, user_text, assistant_excerpt
        ) VALUES (
            @id, @namespace, @session_id, @user_message_id, @assistant_message_id,
            @created_at, @title, @project_path, @project_host, @marker_color, @user_text, @assistant_excerpt
        )
    `).run({
        id,
        namespace: input.namespace,
        session_id: input.sessionId,
        user_message_id: input.userMessageId ?? null,
        assistant_message_id: input.assistantMessageId ?? null,
        created_at: createdAt,
        title: input.title,
        project_path: input.projectPath ?? null,
        project_host: input.projectHost ?? null,
        marker_color: input.markerColor ?? null,
        user_text: input.userText,
        assistant_excerpt: input.assistantExcerpt
    })

    if (input.assistantMessageId && input.projectHost) {
        db.prepare(`
            UPDATE conversation_history
            SET project_host = CASE
                    WHEN project_host IS NULL OR project_host = '' THEN @project_host
                    ELSE project_host
                END,
                project_path = CASE
                    WHEN project_path IS NULL OR project_path = '' THEN @project_path
                    ELSE project_path
                END
            WHERE namespace = @namespace
              AND session_id = @session_id
              AND assistant_message_id = @assistant_message_id
        `).run({
            namespace: input.namespace,
            session_id: input.sessionId,
            assistant_message_id: input.assistantMessageId,
            project_path: input.projectPath ?? null,
            project_host: input.projectHost
        })
    }

    const row = input.assistantMessageId
        ? db.prepare('SELECT * FROM conversation_history WHERE namespace = ? AND session_id = ? AND assistant_message_id = ? LIMIT 1')
            .get(input.namespace, input.sessionId, input.assistantMessageId) as DbHistoryRow | undefined
        : db.prepare('SELECT * FROM conversation_history WHERE id = ?').get(id) as DbHistoryRow | undefined

    if (!row) {
        throw new Error('Failed to create conversation history entry')
    }

    return toStoredHistoryEntry(row)
}

export function mergeHistoryEntries(
    db: Database,
    fromSessionId: string,
    toSessionId: string,
    namespace: string
): MergeHistoryEntriesResult {
    if (fromSessionId === toSessionId) {
        return { moved: 0, duplicatesRemoved: 0 }
    }

    try {
        db.exec('BEGIN')

        const duplicatesRemoved = db.prepare(`
            DELETE FROM conversation_history
            WHERE session_id = @fromSessionId
              AND assistant_message_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM conversation_history AS target
                  WHERE target.session_id = @toSessionId
                    AND target.assistant_message_id = conversation_history.assistant_message_id
              )
        `).run({ fromSessionId, toSessionId }).changes

        const moved = db.prepare(`
            UPDATE conversation_history
            SET session_id = @toSessionId,
                namespace = @namespace
            WHERE session_id = @fromSessionId
        `).run({ fromSessionId, toSessionId, namespace }).changes

        db.exec('COMMIT')
        return { moved, duplicatesRemoved }
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

export function searchHistory(db: Database, options: SearchHistoryOptions): SearchHistoryResult {
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, options.limit ?? 50)) : 50
    const params: Array<string | number> = [options.namespace]
    const where: string[] = ['namespace = ?']

    if (options.scope === 'session') {
        where.push('session_id = ?')
        params.push(options.sessionId ?? '')
    } else if (options.scope === 'project') {
        where.push('project_path = ?')
        params.push(options.projectPath ?? '')
    }

    const likeQuery = normalizeLikeQuery(options.query)
    if (likeQuery) {
        if (options.userOnly) {
            where.push("lower(user_text) LIKE ? ESCAPE '\\'")
            params.push(likeQuery)
        } else {
            where.push(`(
                lower(title) LIKE ? ESCAPE '\\'
                OR lower(COALESCE(project_path, '')) LIKE ? ESCAPE '\\'
                OR lower(COALESCE(project_host, '')) LIKE ? ESCAPE '\\'
                OR lower(user_text) LIKE ? ESCAPE '\\'
                OR lower(assistant_excerpt) LIKE ? ESCAPE '\\'
            )`)
            params.push(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery)
        }
    }

    if (options.before) {
        where.push('(created_at < ? OR (created_at = ? AND id < ?))')
        params.push(options.before.createdAt, options.before.createdAt, options.before.id)
    }

    const rows = db.prepare(`
        SELECT * FROM conversation_history
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `).all(...params, limit + 1) as DbHistoryRow[]

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const last = pageRows[pageRows.length - 1]

    return {
        entries: pageRows.map(toStoredHistoryEntry),
        page: {
            limit,
            nextBeforeCreatedAt: hasMore && last ? last.created_at : null,
            nextBeforeId: hasMore && last ? last.id : null,
            hasMore
        }
    }
}
