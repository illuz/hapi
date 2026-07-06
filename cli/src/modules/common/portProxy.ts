import type { PortProxyCheckRequest, PortProxyCheckResponse, PortProxyFetchRequest, PortProxyFetchResponse } from '@hapi/protocol/portMappings'

const MAX_PROXY_RESPONSE_BYTES = 20 * 1024 * 1024
const ALLOWED_TARGET_HOSTS = new Set(['127.0.0.1', 'localhost'])
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
])

function buildTargetUrl(targetHost: string | undefined, port: number, path: string = '/'): string {
    const host = targetHost ?? '127.0.0.1'
    if (!ALLOWED_TARGET_HOSTS.has(host)) {
        throw new Error('Only localhost port proxy targets are allowed')
    }
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
        throw new Error('Invalid proxy path')
    }
    return `http://${host}:${port}${path}`
}

function createAbortSignal(timeoutMs: number): AbortSignal {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), timeoutMs).unref?.()
    return controller.signal
}

function normalizeRequestHeaders(headers?: Record<string, string>): Headers {
    const result = new Headers()
    for (const [key, value] of Object.entries(headers ?? {})) {
        const lower = key.toLowerCase()
        if (HOP_BY_HOP_HEADERS.has(lower)) continue
        result.set(key, value)
    }
    return result
}

function collectResponseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
        result[key] = value
    })
    return result
}

export async function checkPortProxyTarget(request: PortProxyCheckRequest): Promise<PortProxyCheckResponse> {
    try {
        const response = await fetch(buildTargetUrl(request.targetHost, request.port, '/'), {
            method: 'GET',
            signal: createAbortSignal(3_000)
        })
        await response.body?.cancel().catch(() => undefined)
        return { success: true }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Port is not reachable' }
    }
}

export async function fetchPortProxyTarget(request: PortProxyFetchRequest): Promise<PortProxyFetchResponse> {
    try {
        const method = request.method.toUpperCase()
        const headers = normalizeRequestHeaders(request.headers)
        const hasBody = method !== 'GET' && method !== 'HEAD' && request.bodyBase64
        const response = await fetch(buildTargetUrl(request.targetHost, request.port, request.path), {
            method,
            headers,
            body: hasBody ? Buffer.from(request.bodyBase64!, 'base64') : undefined,
            redirect: 'manual',
            signal: createAbortSignal(30_000)
        })

        const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
        if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_RESPONSE_BYTES) {
            await response.body?.cancel().catch(() => undefined)
            return { success: false, error: 'Response body too large for port proxy' }
        }

        const body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
        if (body.byteLength > MAX_PROXY_RESPONSE_BYTES) {
            return { success: false, error: 'Response body too large for port proxy' }
        }

        return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            headers: collectResponseHeaders(response.headers),
            bodyBase64: body.byteLength > 0 ? body.toString('base64') : undefined
        }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to proxy local port' }
    }
}
