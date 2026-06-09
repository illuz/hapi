import type { Database } from 'bun:sqlite'

import type { StoredHistoryEntry } from './types'
import {
    addHistoryEntry,
    searchHistory,
    type AddHistoryEntryInput,
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

    search(options: SearchHistoryOptions): SearchHistoryResult {
        return searchHistory(this.db, options)
    }
}

export type { AddHistoryEntryInput, SearchHistoryOptions, SearchHistoryResult, HistorySearchScope } from './history'
