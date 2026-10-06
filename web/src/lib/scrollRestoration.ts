export const SCROLL_RESTORATION_STORAGE_KEY = 'tsr-scroll-restoration-v1_3'

const MAX_CACHE_ENTRIES = 64
const MAX_ELEMENTS_PER_ENTRY = 12
const MAX_SELECTOR_LENGTH = 2048
const MAX_SERIALIZED_LENGTH = 128 * 1024

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export type ScrollRestorationEntry = { scrollX: number; scrollY: number }
export type ScrollRestorationByElement = Record<string, ScrollRestorationEntry>
export type ScrollRestorationByKey = Record<string, ScrollRestorationByElement>

function getSessionStorage(): StorageLike | null {
    try {
        if (typeof window !== 'undefined' && typeof window.sessionStorage?.setItem === 'function') {
            return window.sessionStorage
        }
    } catch {
        // sessionStorage 可能在隐私或受限环境不可用。
    }
    return null
}

function compactElementEntries(entries: ScrollRestorationByElement): ScrollRestorationByElement {
    const selectors = Object.keys(entries)
        .filter((selector) => selector.length <= MAX_SELECTOR_LENGTH)
        .slice(-MAX_ELEMENTS_PER_ENTRY)
    const compacted: ScrollRestorationByElement = {}
    for (const selector of selectors) {
        const entry = entries[selector]
        if (!entry || !Number.isFinite(entry.scrollX) || !Number.isFinite(entry.scrollY)) {
            continue
        }
        compacted[selector] = {
            scrollX: entry.scrollX,
            scrollY: entry.scrollY,
        }
    }
    return compacted
}

function serializedLength(state: ScrollRestorationByKey): number {
    return JSON.stringify(state).length
}

export function compactScrollRestorationState(state: ScrollRestorationByKey): ScrollRestorationByKey {
    const keys = Object.keys(state).slice(-MAX_CACHE_ENTRIES)
    const compacted: ScrollRestorationByKey = {}
    for (const key of keys) {
        if (key.length > MAX_SELECTOR_LENGTH) continue
        const entries = state[key]
        if (!entries || typeof entries !== 'object') continue
        compacted[key] = compactElementEntries(entries)
    }

    while (serializedLength(compacted) > MAX_SERIALIZED_LENGTH) {
        const cacheKeys = Object.keys(compacted)
        if (cacheKeys.length > 1) {
            delete compacted[cacheKeys[0]]
            continue
        }
        const onlyKey = cacheKeys[0]
        if (!onlyKey) break
        const selectors = Object.keys(compacted[onlyKey] ?? {})
        if (selectors.length === 0) break
        delete compacted[onlyKey][selectors[0]]
    }
    return compacted
}

function compactSerializedState(value: string): string {
    try {
        const parsed = JSON.parse(value) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value
        return JSON.stringify(compactScrollRestorationState(parsed as ScrollRestorationByKey))
    } catch {
        return value
    }
}

const patchedPrototypes = new WeakMap<object, Storage['setItem']>()

/** 为 TanStack Router 的滚动缓存增加容量上限和失败降级。 */
export function installSafeScrollRestoration(
    storage: StorageLike | null = getSessionStorage(),
): void {
    if (!storage || typeof Storage === 'undefined' || !(storage instanceof Storage)) return

    const prototype = Object.getPrototypeOf(storage) as Storage
    const existingPatch = patchedPrototypes.get(prototype)
    if (existingPatch && prototype.setItem !== existingPatch) {
        patchedPrototypes.delete(prototype)
    }
    if (patchedPrototypes.has(prototype)) return

    const originalSetItem = prototype.setItem
    const safeSetItem: Storage['setItem'] = function (this: Storage, key, value) {
        if (key !== SCROLL_RESTORATION_STORAGE_KEY) {
            return originalSetItem.call(this, key, value)
        }

        const compacted = compactSerializedState(value)
        try {
            return originalSetItem.call(this, key, compacted)
        } catch {
            // 滚动位置只是体验增强；存储满时删除旧缓存并继续导航。
            try {
                this.removeItem(key)
            } catch {
                // 忽略存储清理失败。
            }
        }
    }

    try {
        Object.defineProperty(prototype, 'setItem', {
            configurable: true,
            writable: true,
            value: safeSetItem,
        })
    } catch {
        return
    }
    patchedPrototypes.set(prototype, safeSetItem)

    try {
        const existing = storage.getItem(SCROLL_RESTORATION_STORAGE_KEY)
        if (existing !== null) {
            storage.removeItem(SCROLL_RESTORATION_STORAGE_KEY)
            storage.setItem(SCROLL_RESTORATION_STORAGE_KEY, compactSerializedState(existing))
        }
    } catch {
        try {
            storage.removeItem(SCROLL_RESTORATION_STORAGE_KEY)
        } catch {
            // 忽略存储清理失败。
        }
    }
}
