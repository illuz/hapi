import type { Database } from 'bun:sqlite'

import type { StoredHistoryEntry } from './types'
import {
    addHistoryEntry,
    deleteHistoryEntriesForMessages,
    mergeHistoryEntries,
    searchHistory,
    type AddHistoryEntryInput,
    type MergeHistoryEntriesResult,
    type SearchHistoryOptions,
    type SearchHistoryResult
} from './history'

export class HistoryStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addEntry(input: AddHistoryEntryInput): StoredHistoryEntry {
        return addHistoryEntry(this.db, input)
    }

    deleteEntriesForMessages(sessionId: string, messageIds: string[]): number {
        return deleteHistoryEntriesForMessages(this.db, sessionId, messageIds)
    }

    mergeSessionEntries(
        fromSessionId: string,
        toSessionId: string,
        namespace: string
    ): MergeHistoryEntriesResult {
        return mergeHistoryEntries(this.db, fromSessionId, toSessionId, namespace)
    }

    search(options: SearchHistoryOptions): SearchHistoryResult {
        return searchHistory(this.db, options)
    }
}

export type {
    AddHistoryEntryInput,
    MergeHistoryEntriesResult,
    SearchHistoryOptions,
    SearchHistoryResult,
    HistorySearchScope
} from './history'
