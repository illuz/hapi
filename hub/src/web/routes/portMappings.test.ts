import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { PORT_MAPPING_TOKEN_QUERY_PARAM, type PortMapping } from '@hapi/protocol/portMappings'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { StoredPortMapping } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createPortMappingRoutes, createPortProxyRoutes } from './portMappings'

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides
    }
}

function createMapping(overrides?: Partial<PortMapping>): PortMapping {
    return {
        id: 'mapping-1',
        namespace: 'default',
        machineId: 'machine-1',
        projectPath: '/repo',
        alias: 'repo_8080',
        targetType: 'port',
        port: 8080,
        targetHost: '127.0.0.1',
        staticPath: null,
        enabled: true,
        status: 'active',
        durationMs: 30 * 60_000,
        expiresAt: Date.now() + 30 * 60_000,
        lastEnabledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides
    }
}

function createApp(options?: {
    namespace?: string
    engine?: Partial<SyncEngine> | null
    includeProxy?: boolean
}) {
    const engine = options?.engine === undefined
        ? {
            getMachine: () => createMachine(),
            listPortMappings: () => []
        } as Partial<SyncEngine>
        : options.engine

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', options?.namespace ?? 'default')
        await next()
    })
    app.route('/api', createPortMappingRoutes(() => engine as SyncEngine | null))
    if (options?.includeProxy) {
        app.route('/', createPortProxyRoutes(() => engine as SyncEngine | null))
    }
    return app
}

describe('port mapping routes', () => {
    it('creates port mappings with namespace, project path, access URL, and access token', async () => {
        const calls: unknown[] = []
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                createPortMapping: (params: unknown) => {
                    calls.push(params)
                    return { type: 'success', mapping: createMapping(), accessToken: 'secret-token' }
                }
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/port-mappings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetType: 'port', projectPath: '/repo', port: 8080 })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { mapping: PortMapping; accessUrl: string }
        expect(body.mapping.accessUrl).toBe(body.accessUrl)
        expect(body.accessUrl).toBe('http://localhost/ports/repo_8080/?hapi_port_token=secret-token')
        expect(calls).toEqual([{
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: undefined,
            targetType: 'port',
            port: 8080,
            durationMs: undefined
        }])
    })

    it('creates static mappings through the same endpoint', async () => {
        const calls: unknown[] = []
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                createPortMapping: (params: unknown) => {
                    calls.push(params)
                    return {
                        type: 'success',
                        mapping: createMapping({
                            alias: 'repo_dist',
                            targetType: 'static',
                            port: null,
                            targetHost: null,
                            staticPath: 'dist'
                        }),
                        accessToken: 'static-token'
                    }
                }
            } as Partial<SyncEngine>
        })

        const response = await app.request('/api/machines/machine-1/port-mappings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetType: 'static', projectPath: '/repo', staticPath: 'dist' })
        })

        expect(response.status).toBe(200)
        expect((await response.json() as { accessUrl: string }).accessUrl).toContain('static-token')
        expect(calls).toEqual([{
            namespace: 'default',
            machineId: 'machine-1',
            projectPath: '/repo',
            alias: undefined,
            targetType: 'static',
            staticPath: 'dist',
            durationMs: undefined
        }])
    })

    it('returns access errors for unavailable engines, unknown machines, and cross-namespace machines', async () => {
        const unavailable = await createApp({ engine: null })
            .request('/api/machines/machine-1/port-mappings?projectPath=/repo')
        expect(unavailable.status).toBe(503)

        const missing = await createApp({
            engine: {
                getMachine: () => undefined
            } as Partial<SyncEngine>
        }).request('/api/machines/machine-1/port-mappings?projectPath=/repo')
        expect(missing.status).toBe(404)

        const denied = await createApp({
            engine: {
                getMachine: () => createMachine({ namespace: 'other' })
            } as Partial<SyncEngine>
        }).request('/api/machines/machine-1/port-mappings?projectPath=/repo')
        expect(denied.status).toBe(403)
    })

    it('checks, enables, disables, and deletes mappings through the sync engine', async () => {
        const calls: unknown[] = []
        const mapping = createMapping()
        const app = createApp({
            engine: {
                getMachine: () => createMachine(),
                checkPortMapping: async (params: unknown) => {
                    calls.push(['check', params])
                    return { success: true }
                },
                enablePortMapping: (params: unknown) => {
                    calls.push(['enable', params])
                    return { type: 'success', mapping, accessToken: 'enabled-token' }
                },
                disablePortMapping: (params: unknown) => {
                    calls.push(['disable', params])
                    return { type: 'success', mapping: { ...mapping, enabled: false, status: 'disabled' } }
                },
                deletePortMapping: (params: unknown) => {
                    calls.push(['delete', params])
                    return { type: 'success', mapping: { ...mapping, enabled: false, status: 'disabled' } }
                }
            } as Partial<SyncEngine>
        })

        const check = await app.request('/api/machines/machine-1/port-mappings/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ port: 8080 })
        })
        expect(check.status).toBe(200)
        expect(await check.json()).toEqual({ success: true })

        const enable = await app.request('/api/port-mappings/mapping-1/enable', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ durationMs: 60_000 })
        })
        expect(enable.status).toBe(200)
        expect((await enable.json() as { accessUrl: string }).accessUrl).toContain('enabled-token')

        const disable = await app.request('/api/port-mappings/mapping-1/disable', { method: 'POST' })
        expect(disable.status).toBe(200)

        const deleted = await app.request('/api/port-mappings/mapping-1', { method: 'DELETE' })
        expect(deleted.status).toBe(200)

        expect(calls).toEqual([
            ['check', { machineId: 'machine-1', port: 8080, targetHost: '127.0.0.1' }],
            ['enable', { namespace: 'default', id: 'mapping-1', durationMs: 60_000 }],
            ['disable', { namespace: 'default', id: 'mapping-1' }],
            ['delete', { namespace: 'default', id: 'mapping-1' }]
        ])
    })

    it('rejects proxy requests without a valid mapping token', async () => {
        const app = createApp({
            includeProxy: true,
            engine: {
                resolvePortProxyMapping: () => null
            } as Partial<SyncEngine>
        })

        const response = await app.request('/ports/repo_8080/')

        expect(response.status).toBe(403)
        expect(await response.text()).toContain('unauthorized')
    })

    it('exchanges query tokens for cookies and proxies subsequent port requests', async () => {
        const mapping = createMapping()
        const calls: unknown[] = []
        const app = createApp({
            includeProxy: true,
            engine: {
                resolvePortProxyMapping: (_alias: string, tokens: string[]) => {
                    calls.push(['resolve', tokens])
                    if (!tokens.includes('secret-token')) return null
                    return {
                        mapping,
                        stored: { id: mapping.id } as StoredPortMapping
                    }
                },
                getPortMappingCookieName: () => 'hapi_port_mapping_1',
                proxyPortMappingFetch: async (params: unknown) => {
                    calls.push(['proxy', params])
                    return {
                        success: true,
                        status: 202,
                        statusText: 'Accepted',
                        headers: {
                            'content-type': 'text/plain',
                            location: 'http://127.0.0.1:8080/next?ok=1',
                            'set-cookie': 'sid=abc; Path=/'
                        },
                        bodyBase64: Buffer.from('proxied').toString('base64')
                    }
                }
            } as Partial<SyncEngine>
        })

        const tokenResponse = await app.request(`/ports/repo_8080/?${PORT_MAPPING_TOKEN_QUERY_PARAM}=secret-token`)
        expect(tokenResponse.status).toBe(302)
        expect(tokenResponse.headers.get('location')).toBe('http://localhost/ports/repo_8080/')
        expect(tokenResponse.headers.get('set-cookie')).toContain('hapi_port_mapping_1=secret-token')
        expect(tokenResponse.headers.get('set-cookie')).toContain('Path=/ports/repo_8080')

        const proxyResponse = await app.request('/ports/repo_8080/path?x=1', {
            method: 'POST',
            headers: {
                cookie: 'hapi_port_mapping_1=secret-token; app=keep',
                'content-type': 'text/plain',
                'accept-encoding': 'gzip'
            },
            body: 'payload'
        })

        expect(proxyResponse.status).toBe(202)
        expect(await proxyResponse.text()).toBe('proxied')
        expect(proxyResponse.headers.get('location')).toBe('/ports/repo_8080/next?ok=1')
        expect(proxyResponse.headers.get('set-cookie')).toBe('sid=abc; Path=/ports/repo_8080')
        expect(calls).toContainEqual(['proxy', {
            mapping,
            method: 'POST',
            path: '/path?x=1',
            headers: {
                cookie: 'app=keep',
                'content-type': 'text/plain'
            },
            bodyBase64: Buffer.from('payload').toString('base64')
        }])
    })

    it('serves static mappings through the proxy route', async () => {
        const mapping = createMapping({
            alias: 'repo_dist',
            targetType: 'static',
            port: null,
            targetHost: null,
            staticPath: 'dist'
        })
        const app = createApp({
            includeProxy: true,
            engine: {
                resolvePortProxyMapping: (_alias: string, tokens: string[]) => (
                    tokens.includes('static-token')
                        ? { mapping, stored: { id: mapping.id } as StoredPortMapping }
                        : null
                ),
                getPortMappingCookieName: () => 'hapi_port_mapping_static',
                proxyPortMappingFetch: async () => ({
                    success: true,
                    status: 200,
                    statusText: 'OK',
                    headers: {
                        'content-type': 'text/html; charset=utf-8',
                        location: '/next'
                    },
                    bodyBase64: Buffer.from('<html>static</html>').toString('base64')
                })
            } as Partial<SyncEngine>
        })

        const tokenResponse = await app.request(`/ports/repo_dist/?${PORT_MAPPING_TOKEN_QUERY_PARAM}=static-token`)
        expect(tokenResponse.status).toBe(302)

        const proxyResponse = await app.request('/ports/repo_dist/', {
            headers: { cookie: 'hapi_port_mapping_static=static-token' }
        })
        expect(proxyResponse.status).toBe(200)
        expect(await proxyResponse.text()).toBe('<html>static</html>')
        expect(proxyResponse.headers.get('location')).toBe('/ports/repo_dist/next')
    })
})
