import os from 'node:os'

const ROOT_OVERRIDE_ENV = 'HAPI_ASSUME_ROOT'

/**
 * Detect whether the hub process is running as the OS root user.
 * - POSIX: uid === 0
 * - Otherwise (e.g. Windows): username === 'root'
 * - Any failure is treated as non-root.
 */
function detectRunningAsRoot(): boolean {
    try {
        if (typeof process.getuid === 'function') {
            return process.getuid() === 0
        }
        return os.userInfo().username === 'root'
    } catch {
        return false
    }
}

/**
 * Whether the hub runs as the OS root user. Used to decide how permissive the
 * default permission mode should be when deriving cross-flavor sessions.
 *
 * The `HAPI_ASSUME_ROOT` env var (`'1'` / `'0'`) takes precedence and is mainly
 * intended for tests; it is evaluated on every call (no caching) so overrides
 * can be scoped per test case.
 */
export function isRunningAsRoot(): boolean {
    const override = process.env[ROOT_OVERRIDE_ENV]
    if (override === '1') {
        return true
    }
    if (override === '0') {
        return false
    }
    return detectRunningAsRoot()
}
