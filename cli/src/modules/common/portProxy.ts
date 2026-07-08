import { lstat, readFile, realpath } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type {
    PortProxyCheckRequest,
    PortProxyCheckResponse,
    PortProxyFetchRequest,
    PortProxyFetchResponse,
    StaticSiteProxyFetchRequest
} from '@hapi/protocol/portMappings'
import { isWithinPathRoot } from './pathSecurity'

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

function isNotFound(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT'
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

export async function fetchStaticSiteContent(request: StaticSiteProxyFetchRequest): Promise<PortProxyFetchResponse> {
    try {
        if (!request.path.startsWith('/') || request.path.startsWith('//') || /[\r\n]/.test(request.path)) {
            throw new StaticForbiddenError('Invalid static file path')
        }
        const method = request.method.toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') {
            return {
                success: true,
                status: 405,
                statusText: 'Method Not Allowed',
                headers: {
                    allow: 'GET, HEAD',
                    'content-type': 'text/plain; charset=utf-8'
                },
                bodyBase64: method === 'HEAD' ? undefined : Buffer.from('Only GET and HEAD are supported for static mappings.').toString('base64')
            }
        }

        const staticRoot = await resolveStaticRoot(request.projectPath, request.staticPath)
        const filePath = await resolveStaticRequestPath(staticRoot, request.path)
        const fileStats = await lstat(filePath)
        if (fileStats.size > MAX_PROXY_RESPONSE_BYTES) {
            return { success: false, error: 'Response body too large for static mapping' }
        }
        const buffer = method === 'HEAD' ? Buffer.alloc(0) : await readFile(filePath)

        return {
            success: true,
            status: 200,
            statusText: 'OK',
            headers: {
                'content-type': guessContentType(filePath),
                'content-length': String(fileStats.size),
                'cache-control': 'no-store'
            },
            bodyBase64: method === 'HEAD' || buffer.byteLength === 0 ? undefined : buffer.toString('base64')
        }
    } catch (error) {
        if (error instanceof StaticNotFoundError) {
            return {
                success: true,
                status: 404,
                statusText: 'Not Found',
                headers: { 'content-type': 'text/plain; charset=utf-8' },
                bodyBase64: Buffer.from(error.message).toString('base64')
            }
        }
        if (error instanceof StaticForbiddenError) {
            return {
                success: true,
                status: 403,
                statusText: 'Forbidden',
                headers: { 'content-type': 'text/plain; charset=utf-8' },
                bodyBase64: Buffer.from(error.message).toString('base64')
            }
        }
        return { success: false, error: error instanceof Error ? error.message : 'Failed to serve static mapping' }
    }
}

class StaticNotFoundError extends Error {}
class StaticForbiddenError extends Error {}

async function resolveStaticRoot(projectPath: string, staticPath: string): Promise<string> {
    const projectStats = await lstat(projectPath)
    if (!projectStats.isDirectory()) {
        throw new StaticNotFoundError('Project path is not a directory')
    }

    const projectRoot = await realpath(projectPath)
    const candidate = resolve(projectRoot, staticPath)
    if (!isWithinPathRoot(candidate, projectRoot)) {
        throw new StaticForbiddenError('Static path must stay within the project directory')
    }

    const stats = await lstat(candidate).catch((error) => {
        if (isNotFound(error)) {
            throw new StaticNotFoundError('Static directory not found')
        }
        throw error
    })
    if (!stats.isDirectory()) {
        throw new StaticNotFoundError('Static path is not a directory')
    }

    const canonical = await realpath(candidate)
    if (!isWithinPathRoot(canonical, projectRoot)) {
        throw new StaticForbiddenError('Resolved static directory points outside the project directory')
    }

    return canonical
}

async function resolveStaticRequestPath(staticRoot: string, requestPath: string): Promise<string> {
    const url = new URL(requestPath, 'http://static.local')
    const decodedPath = decodeURIComponent(url.pathname).replace(/\\/g, '/')
    if (/[\0\r\n]/.test(decodedPath)) {
        throw new StaticForbiddenError('Invalid static file path')
    }

    const requestedPath = resolve(staticRoot, `.${decodedPath}`)
    if (!isWithinPathRoot(requestedPath, staticRoot)) {
        throw new StaticForbiddenError('Static request path escapes the mapped directory')
    }

    const direct = await resolveExistingFileWithinRoot(requestedPath, staticRoot)
    if (direct) {
        return direct
    }

    const directoryIndex = await resolveExistingFileWithinRoot(join(requestedPath, 'index.html'), staticRoot)
    if (directoryIndex) {
        return directoryIndex
    }

    const looksLikeAsset = /\.[A-Za-z0-9]+$/.test(decodedPath)
    if (!looksLikeAsset) {
        const spaIndex = await resolveExistingFileWithinRoot(join(staticRoot, 'index.html'), staticRoot)
        if (spaIndex) {
            return spaIndex
        }
    }

    throw new StaticNotFoundError('Static file not found')
}

async function resolveExistingFileWithinRoot(candidate: string, root: string): Promise<string | null> {
    try {
        const stats = await lstat(candidate)
        if (stats.isDirectory()) {
            return null
        }
        if (!stats.isFile()) {
            return null
        }
        const canonical = await realpath(candidate)
        if (!isWithinPathRoot(canonical, root)) {
            throw new StaticForbiddenError('Static file resolves outside the mapped directory')
        }
        return canonical
    } catch (error) {
        if (isNotFound(error)) {
            return null
        }
        throw error
    }
}

function guessContentType(filePath: string): string {
    switch (extname(filePath).toLowerCase()) {
        case '.html':
            return 'text/html; charset=utf-8'
        case '.css':
            return 'text/css; charset=utf-8'
        case '.js':
        case '.mjs':
            return 'application/javascript; charset=utf-8'
        case '.json':
            return 'application/json; charset=utf-8'
        case '.svg':
            return 'image/svg+xml'
        case '.png':
            return 'image/png'
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg'
        case '.gif':
            return 'image/gif'
        case '.webp':
            return 'image/webp'
        case '.ico':
            return 'image/x-icon'
        case '.txt':
            return 'text/plain; charset=utf-8'
        case '.map':
            return 'application/json; charset=utf-8'
        case '.woff':
            return 'font/woff'
        case '.woff2':
            return 'font/woff2'
        case '.ttf':
            return 'font/ttf'
        default:
            return 'application/octet-stream'
    }
}
