import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('NamespaceSettingsStore', () => {
    it('defaults each namespace to AUTO off and persists changes', () => {
        const store = new Store(':memory:')

        expect(store.namespaceSettings.get('alpha').autoRetryEnabled).toBe(false)
        expect(store.namespaceSettings.setAutoRetryEnabled('alpha', true).autoRetryEnabled).toBe(true)
        expect(store.namespaceSettings.get('alpha').autoRetryEnabled).toBe(true)
        expect(store.namespaceSettings.get('beta').autoRetryEnabled).toBe(false)
    })

    it('migrates a legacy per-session AUTO choice once', () => {
        const store = new Store(':memory:')
        store.sessions.getOrCreateSession(
            'legacy-session',
            {
                path: '/tmp/project',
                host: 'localhost',
                autoContinue: {
                    enabled: false,
                    remaining: 20,
                    maxRuns: 20,
                    keywords: ['next step'],
                    messageText: 'continue',
                    retryOnOverload: true
                }
            },
            null,
            'legacy'
        )

        expect(store.namespaceSettings.get('legacy').autoRetryEnabled).toBe(true)

        // An explicit off value wins over the legacy fallback on later reads.
        store.namespaceSettings.setAutoRetryEnabled('legacy', false)
        expect(store.namespaceSettings.get('legacy').autoRetryEnabled).toBe(false)
    })
})
