import {
    PortMappingCreateRequestSchema,
    PortMappingEnableRequestSchema,
    PortMappingUpdateRequestSchema,
    PortProxyCheckRequestSchema,
    PORT_MAPPING_TOKEN_QUERY_PARAM,
    type PortMapping
} from '@hapi/protocol/portMappings'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSyncEngine } from './guards'

const MAX_PROXY_BODY_BYTES = 20 * 1024 * 1024
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
])
const RESPONSE_HEADERS_TO_DROP = new Set([
    ...HOP_BY_HOP_HEADERS,
    'content-encoding'
])

function toHttpStatus(code?: string): ContentfulStatusCode {
    if (code === 'not_found') return 404
    if (code === 'alias_conflict') return 409
    if (code === 'invalid_state') return 400
    return 502
}

function buildAccessUrl(c: { req: { url: string } }, mapping: PortMapping, accessToken?: string): string | undefined {
    if (!accessToken) return undefined
    const url = new URL(`/ports/${mapping.alias}/`, c.req.url)
    url.searchParams.set(PORT_MAPPING_TOKEN_QUERY_PARAM, accessToken)
    return url.toString()
}

function withAccessUrl(c: { req: { url: string } }, result: { mapping: PortMapping; accessToken?: string }) {
    const accessUrl = buildAccessUrl(c, result.mapping, result.accessToken)
    return {
        mapping: accessUrl ? { ...result.mapping, accessUrl } : result.mapping,
        accessUrl
    }
}

export function createPortMappingRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines/:id/port-mappings', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine

        const projectPath = c.req.query('projectPath')?.trim()
        if (!projectPath) {
            return c.json({ error: 'projectPath is required' }, 400)
        }

        return c.json({
            mappings: engine.listPortMappings({
                namespace: c.get('namespace'),
                machineId,
                projectPath
            })
        })
    })

    app.post('/machines/:id/port-mappings/check', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine

        const body = await c.req.json().catch(() => null)
        const parsed = PortProxyCheckRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        return c.json(await engine.checkPortMapping({
            machineId,
            port: parsed.data.port,
            targetHost: parsed.data.targetHost
        }))
    })

    app.post('/machines/:id/port-mappings', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine

        const body = await c.req.json().catch(() => null)
        const parsed = PortMappingCreateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = engine.createPortMapping({
            namespace: c.get('namespace'),
            machineId,
            projectPath: parsed.data.projectPath,
            alias: parsed.data.alias,
            port: parsed.data.port,
            durationMs: parsed.data.durationMs
        })
        if (result.type === 'error') {
            return c.json({ error: result.message, code: result.code }, toHttpStatus(result.code))
        }

        return c.json(withAccessUrl(c, result))
    })

    app.patch('/port-mappings/:mappingId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = PortMappingUpdateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = engine.updatePortMapping({
            namespace: c.get('namespace'),
            id: c.req.param('mappingId'),
            alias: parsed.data.alias,
            port: parsed.data.port,
            durationMs: parsed.data.durationMs
        })
        if (result.type === 'error') {
            return c.json({ error: result.message, code: result.code }, toHttpStatus(result.code))
        }
        return c.json(withAccessUrl(c, result))
    })

    app.post('/port-mappings/:mappingId/enable', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => ({}))
        const parsed = PortMappingEnableRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = engine.enablePortMapping({
            namespace: c.get('namespace'),
            id: c.req.param('mappingId'),
            durationMs: parsed.data?.durationMs
        })
        if (result.type === 'error') {
            return c.json({ error: result.message, code: result.code }, toHttpStatus(result.code))
        }
        return c.json(withAccessUrl(c, result))
    })

    app.post('/port-mappings/:mappingId/disable', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const result = engine.disablePortMapping({ namespace: c.get('namespace'), id: c.req.param('mappingId') })
        if (result.type === 'error') {
            return c.json({ error: result.message, code: result.code }, toHttpStatus(result.code))
        }
        return c.json(withAccessUrl(c, result))
    })

    app.delete('/port-mappings/:mappingId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const result = engine.deletePortMapping({ namespace: c.get('namespace'), id: c.req.param('mappingId') })
        if (result.type === 'error') {
            return c.json({ error: result.message, code: result.code }, toHttpStatus(result.code))
        }
        return c.json(withAccessUrl(c, result))
    })

    return app
}

export function createPortProxyRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const handler = async (c: Context<WebAppEnv>) => handlePortProxyRequest(c, getSyncEngine)
    app.all('/ports/:alias', handler)
    app.all('/ports/:alias/*', handler)
    return app
}

async function handlePortProxyRequest(c: Context<WebAppEnv>, getSyncEngine: () => SyncEngine | null): Promise<Response> {
    const engine = getSyncEngine()
    if (!engine) {
        return new Response('Hub is not ready', { status: 503 })
    }

    const alias = c.req.param('alias') as string
    const incoming = new URL(c.req.url)
    const aliasBasePath = `/ports/${alias}`
    if (incoming.pathname === aliasBasePath) {
        incoming.pathname = `${aliasBasePath}/`
        return Response.redirect(incoming.toString(), 302)
    }

    const tokenFromQuery = incoming.searchParams.get(PORT_MAPPING_TOKEN_QUERY_PARAM)
    const cookieTokens = Object.entries(parseCookieHeader(c.req.raw.headers.get('cookie')))
        .filter(([name]) => name.startsWith('hapi_port_'))
        .map(([, value]) => value)
    const tokens = [tokenFromQuery, ...cookieTokens].filter((value): value is string => Boolean(value))
    const resolved = engine.resolvePortProxyMapping(alias, tokens)
    if (!resolved) {
        return new Response('Port mapping is disabled, expired, or unauthorized.', { status: 403 })
    }

    if (tokenFromQuery) {
        incoming.searchParams.delete(PORT_MAPPING_TOKEN_QUERY_PARAM)
        const maxAge = Math.max(1, Math.floor(((resolved.mapping.expiresAt ?? Date.now()) - Date.now()) / 1000))
        return new Response(null, {
            status: 302,
            headers: {
                Location: incoming.toString(),
                'Set-Cookie': `${engine.getPortMappingCookieName(resolved.mapping.id)}=${encodeURIComponent(tokenFromQuery)}; Path=${aliasBasePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
            }
        })
    }

    const targetPath = buildTargetPath(incoming, aliasBasePath)
    const requestHeaders = buildProxyRequestHeaders(c.req.raw.headers)
    const bodyBase64 = await readProxyRequestBody(c.req.raw)
    if (bodyBase64 instanceof Response) {
        return bodyBase64
    }

    const proxied = await engine.proxyPortMappingFetch({
        machineId: resolved.mapping.machineId,
        port: resolved.mapping.port,
        targetHost: resolved.mapping.targetHost,
        method: c.req.raw.method,
        path: targetPath,
        headers: requestHeaders,
        bodyBase64
    })

    if (!proxied.success) {
        return new Response(proxied.error, { status: 502 })
    }

    const headers = buildProxyResponseHeaders(proxied.headers, resolved.mapping)
    const method = c.req.raw.method.toUpperCase()
    const hasBody = method !== 'HEAD' && proxied.status !== 204 && proxied.status !== 304 && proxied.bodyBase64
    const body = hasBody ? Buffer.from(proxied.bodyBase64!, 'base64') : undefined
    return new Response(body, {
        status: proxied.status,
        statusText: proxied.statusText,
        headers
    })
}

function parseCookieHeader(header: string | null): Record<string, string> {
    const result: Record<string, string> = {}
    if (!header) return result
    for (const part of header.split(';')) {
        const [rawName, ...rest] = part.trim().split('=')
        const name = rawName?.trim()
        if (!name) continue
        try {
            result[name] = decodeURIComponent(rest.join('='))
        } catch {
            result[name] = rest.join('=')
        }
    }
    return result
}

function buildTargetPath(incoming: URL, aliasBasePath: string): string {
    const path = incoming.pathname.slice(aliasBasePath.length) || '/'
    incoming.searchParams.delete(PORT_MAPPING_TOKEN_QUERY_PARAM)
    return `${path.startsWith('/') ? path : `/${path}`}${incoming.search}`
}

async function readProxyRequestBody(request: Request): Promise<string | undefined | Response> {
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
        return undefined
    }
    const buffer = Buffer.from(await request.arrayBuffer())
    if (buffer.byteLength > MAX_PROXY_BODY_BYTES) {
        return new Response('Request body too large for port proxy.', { status: 413 })
    }
    return buffer.byteLength > 0 ? buffer.toString('base64') : undefined
}

function buildProxyRequestHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
        const lower = key.toLowerCase()
        if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'host' || lower === 'accept-encoding') return
        if (lower === 'cookie') {
            const forwardedCookies = value
                .split(';')
                .map((part) => part.trim())
                .filter((part) => part && !part.startsWith('hapi_port_'))
            if (forwardedCookies.length > 0) {
                result.cookie = forwardedCookies.join('; ')
            }
            return
        }
        result[lower] = value
    })
    return result
}

function buildProxyResponseHeaders(headers: Record<string, string>, mapping: PortMapping): Headers {
    const result = new Headers()
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase()
        if (RESPONSE_HEADERS_TO_DROP.has(lower)) continue
        if (lower === 'location') {
            result.set(key, rewriteLocationHeader(value, mapping))
            continue
        }
        if (lower === 'set-cookie') {
            result.set(key, rewriteSetCookieHeader(value, mapping))
            continue
        }
        result.set(key, value)
    }
    return result
}

function rewriteLocationHeader(value: string, mapping: PortMapping): string {
    const prefix = `/ports/${mapping.alias}`
    try {
        const parsed = new URL(value)
        const targetOrigin = `http://${mapping.targetHost}:${mapping.port}`
        if (parsed.origin === targetOrigin) {
            return `${prefix}${parsed.pathname}${parsed.search}${parsed.hash}`
        }
        return value
    } catch {
        if (value.startsWith('/')) {
            return `${prefix}${value}`
        }
        return value
    }
}

function rewriteSetCookieHeader(value: string, mapping: PortMapping): string {
    const path = `/ports/${mapping.alias}`
    if (/;\s*path=/i.test(value)) {
        return value.replace(/;\s*path=[^;]*/i, `; Path=${path}`)
    }
    return `${value}; Path=${path}`
}
