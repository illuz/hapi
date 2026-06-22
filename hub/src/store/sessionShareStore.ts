import type { Database } from 'bun:sqlite'
import type { StoredSessionShare } from './types'
import {
    countActiveSessionSharesBySessionIds,
    createSessionShare,
    getSessionShare,
    getSessionShareByTokenHash,
    listSessionShares,
    revokeSessionShare,
    touchSessionShareLastUsed,
    updateSessionShare
} from './sessionShares'

export class SessionShareStore {
    constructor(private readonly db: Database) {
    }

    create(input: Parameters<typeof createSessionShare>[1], now?: number): StoredSessionShare {
        return createSessionShare(this.db, input, now)
    }

    get(id: string, namespace: string): StoredSessionShare | null {
        return getSessionShare(this.db, id, namespace)
    }

    getByTokenHash(tokenHash: string): StoredSessionShare | null {
        return getSessionShareByTokenHash(this.db, tokenHash)
    }

    list(namespace: string, sessionId: string): StoredSessionShare[] {
        return listSessionShares(this.db, namespace, sessionId)
    }

    update(
        namespace: string,
        sessionId: string,
        shareId: string,
        input: Parameters<typeof updateSessionShare>[4],
        now?: number
    ): StoredSessionShare | null {
        return updateSessionShare(this.db, namespace, sessionId, shareId, input, now)
    }

    revoke(namespace: string, sessionId: string, shareId: string, now?: number): StoredSessionShare | null {
        return revokeSessionShare(this.db, namespace, sessionId, shareId, now)
    }

    touchLastUsed(id: string, now?: number): void {
        touchSessionShareLastUsed(this.db, id, now)
    }

    countActiveBySessionIds(namespace: string, sessionIds: string[], now?: number): Record<string, number> {
        return countActiveSessionSharesBySessionIds(this.db, namespace, sessionIds, now)
    }
}
