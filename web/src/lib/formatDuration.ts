/** 格式化执行耗时；达到 1 秒后不再显示小数秒。 */
export function formatDuration(ms: number): string {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
    if (safeMs < 1000) {
        return `${Math.round(safeMs)}ms`
    }

    const totalSeconds = Math.round(safeMs / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const parts: string[] = []

    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
    return parts.join(' ')
}
