import type { Machine } from '@/types/api'

export type MachineHealth = 'healthy' | 'starting' | 'degraded' | 'offline'

export function getMachineHealth(machine: Pick<Machine, 'active' | 'runnerState'>): MachineHealth {
    if (!machine.active) return 'offline'
    if (machine.runnerState?.lastSpawnError) return 'degraded'
    const status = machine.runnerState?.status?.toLowerCase()
    if (status === 'starting' || status === 'connecting' || status === 'restarting') return 'starting'
    if (status === 'error' || status === 'failed' || status === 'stopped') return 'degraded'
    return 'healthy'
}

export function getMachineHealthLabelKey(health: MachineHealth): string {
    return `sessions.machine.health.${health}`
}

