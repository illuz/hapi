const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MachineTitleSource = {
    id: string
    metadata?: {
        displayName?: string
        host?: string
    } | null
}

export function isUuidLike(value: string): boolean {
    return UUID_LIKE_PATTERN.test(value.trim())
}

export function getMachineTitle(machine: MachineTitleSource): string {
    const machineId = machine.id.trim()
    if (machineId && !isUuidLike(machineId)) {
        return machineId
    }

    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}
