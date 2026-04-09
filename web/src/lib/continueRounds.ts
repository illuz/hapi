type ContinueRoundState = {
    nextRound: number
    roundsByLocalId: Record<string, { round: number; source: ContinueSource }>
}

export type ContinueSource = 'manual' | 'auto'

function getStorageKey(sessionId: string): string {
    return `hapi:continue-rounds:${sessionId}`
}

function getDefaultState(): ContinueRoundState {
    return {
        nextRound: 1,
        roundsByLocalId: {}
    }
}

function loadState(sessionId: string): ContinueRoundState {
    if (typeof window === 'undefined') {
        return getDefaultState()
    }

    try {
        const raw = window.localStorage.getItem(getStorageKey(sessionId))
        if (!raw) return getDefaultState()
        const parsed = JSON.parse(raw) as Partial<ContinueRoundState>
        const roundsByLocalId: ContinueRoundState['roundsByLocalId'] = {}
        if (typeof parsed.roundsByLocalId === 'object' && parsed.roundsByLocalId) {
            for (const [localId, value] of Object.entries(parsed.roundsByLocalId)) {
                if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
                    roundsByLocalId[localId] = { round: value, source: 'manual' }
                    continue
                }
                if (!value || typeof value !== 'object') continue
                const record = value as { round?: unknown; source?: unknown }
                if (typeof record.round !== 'number' || !Number.isFinite(record.round) || record.round < 1) continue
                if (record.source !== 'manual' && record.source !== 'auto') continue
                roundsByLocalId[localId] = { round: record.round, source: record.source }
            }
        }
        const maxRound = Math.max(0, ...Object.values(roundsByLocalId).map((entry) => entry.round))
        const nextRound = typeof parsed.nextRound === 'number' && Number.isFinite(parsed.nextRound)
            ? Math.max(Math.floor(parsed.nextRound), maxRound + 1, 1)
            : maxRound + 1
        return { nextRound, roundsByLocalId }
    } catch {
        return getDefaultState()
    }
}

function saveState(sessionId: string, state: ContinueRoundState): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(getStorageKey(sessionId), JSON.stringify(state))
    } catch {
    }
}

export function allocateContinueRound(sessionId: string, localId: string): number {
    return allocateContinueRoundWithSource(sessionId, localId, 'manual')
}

export function allocateContinueRoundWithSource(sessionId: string, localId: string, source: ContinueSource): number {
    const state = loadState(sessionId)
    const existing = state.roundsByLocalId[localId]
    if (existing && typeof existing.round === 'number' && Number.isFinite(existing.round) && existing.round >= 1) {
        return existing.round
    }

    const round = state.nextRound
    saveState(sessionId, {
        nextRound: round + 1,
        roundsByLocalId: {
            ...state.roundsByLocalId,
            [localId]: { round, source }
        }
    })
    return round
}

export function getContinueRound(sessionId: string, localId: string | null | undefined): number | null {
    if (!localId) return null
    const round = loadState(sessionId).roundsByLocalId[localId]
    return round && typeof round.round === 'number' && Number.isFinite(round.round) && round.round >= 1 ? round.round : null
}

export function getContinueSource(sessionId: string, localId: string | null | undefined): ContinueSource | null {
    if (!localId) return null
    const source = loadState(sessionId).roundsByLocalId[localId]?.source
    return source === 'auto' || source === 'manual' ? source : null
}
