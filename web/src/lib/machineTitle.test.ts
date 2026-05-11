import { describe, expect, it } from 'vitest'
import { getMachineTitle, isUuidLike } from './machineTitle'

describe('machineTitle', () => {
    it('prefers a non-UUID machine id directly', () => {
        expect(getMachineTitle({
            id: 'macbook-pro',
            metadata: {
                displayName: 'Ignored display name',
                host: 'ignored-host'
            }
        })).toBe('macbook-pro')
    })

    it('falls back to displayName for UUID machine ids', () => {
        expect(getMachineTitle({
            id: '123e4567-e89b-12d3-a456-426614174000',
            metadata: {
                displayName: 'My Mac',
                host: 'mac-host'
            }
        })).toBe('My Mac')
    })

    it('falls back to host when UUID machine id has no displayName', () => {
        expect(getMachineTitle({
            id: '123e4567-e89b-12d3-a456-426614174000',
            metadata: {
                host: 'mac-host'
            }
        })).toBe('mac-host')
    })

    it('falls back to the shortened id when UUID machine id has no metadata labels', () => {
        expect(getMachineTitle({
            id: '123e4567-e89b-12d3-a456-426614174000',
            metadata: null
        })).toBe('123e4567')
    })

    it('detects UUID-like ids case-insensitively', () => {
        expect(isUuidLike('123E4567-E89B-12D3-A456-426614174000')).toBe(true)
        expect(isUuidLike('office-mac-mini')).toBe(false)
    })
})
