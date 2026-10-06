import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    compactScrollRestorationState,
    installSafeScrollRestoration,
    SCROLL_RESTORATION_STORAGE_KEY,
} from './scrollRestoration'

describe('scroll restoration persistence', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('bounds old route entries and scroll selectors', () => {
        const state: Record<string, Record<string, { scrollX: number; scrollY: number }>> = {}
        for (let route = 0; route < 100; route += 1) {
            state[`/sessions/${route}`] = {}
            for (let selector = 0; selector < 20; selector += 1) {
                state[`/sessions/${route}`][`selector-${selector}`] = { scrollX: selector, scrollY: route }
            }
        }

        const compacted = compactScrollRestorationState(state)
        expect(Object.keys(compacted).length).toBeLessThanOrEqual(64)
        expect(JSON.stringify(compacted).length).toBeLessThanOrEqual(128 * 1024)
        expect(compacted['/sessions/99']).toBeDefined()
    })

    it('does not break navigation when sessionStorage is full', async () => {
        const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import('@tanstack/react-router')
        const root = createRootRoute()
        const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: '/' })])
        const addEventListener = vi.spyOn(document, 'addEventListener')
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException(
                `Failed to execute 'setItem' on 'Storage': Setting the value of '${SCROLL_RESTORATION_STORAGE_KEY}' exceeded the quota.`,
                'QuotaExceededError',
            )
        })
        installSafeScrollRestoration()
        const router = createRouter({
            routeTree,
            history: createMemoryHistory({ initialEntries: ['/'] }),
            scrollRestoration: true,
        })

        try {
            expect(() => router.emit({
                type: 'onRendered',
                fromLocation: undefined,
                toLocation: router.state.location,
                pathChanged: false,
                hrefChanged: false,
                hashChanged: false,
            })).not.toThrow()
        } finally {
            for (const [type, listener, options] of addEventListener.mock.calls) {
                if (type === 'scroll') document.removeEventListener(type, listener, options)
            }
        }
    })
})
