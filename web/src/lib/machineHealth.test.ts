import { describe, expect, it } from 'vitest'
import { getMachineHealth } from './machineHealth'

describe('getMachineHealth', () => {
    it('classifies inactive machines as offline', () => {
        expect(getMachineHealth({ active: false, runnerState: null })).toBe('offline')
    })

    it('prioritizes spawn errors over runner status', () => {
        expect(getMachineHealth({ active: true, runnerState: { status: 'running', lastSpawnError: { message: 'boom', at: 1 } } })).toBe('degraded')
    })

    it('recognizes startup states', () => {
        expect(getMachineHealth({ active: true, runnerState: { status: 'starting' } })).toBe('starting')
    })
})

