import { describe, expect, it } from 'bun:test'
import type { Store } from '../store'
import { createWebApp } from './server'

function createApp(relayMode = false) {
    return createWebApp({
        getSyncEngine: () => null,
        getSseManager: () => null,
        getVisibilityTracker: () => null,
        jwtSecret: new Uint8Array(32),
        store: {} as Store,
        vapidPublicKey: '',
        corsOrigins: [],
        embeddedAssetMap: null,
        relayMode
    })
}

describe('web server', () => {
    it.each([false, true])('returns a plain public homepage when relay mode is %s', async (relayMode) => {
        const response = await createApp(relayMode).request('/')

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
        expect(await response.text()).toBe('It works!')
    })
})
