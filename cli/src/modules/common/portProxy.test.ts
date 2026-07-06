import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkPortProxyTarget, fetchPortProxyTarget } from './portProxy'

let server: Server | null = null

function readRequestBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        request.on('error', reject)
    })
}

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<number> {
    server = createServer((request, response) => {
        void Promise.resolve(handler(request, response)).catch((error) => {
            response.statusCode = 500
            response.end(error instanceof Error ? error.message : String(error))
        })
    })

    await new Promise<void>((resolve) => {
        server!.listen(0, '127.0.0.1', resolve)
    })
    return (server.address() as AddressInfo).port
}

async function stopServer(): Promise<void> {
    const current = server
    server = null
    if (!current) return
    await new Promise<void>((resolve, reject) => {
        current.close((error) => {
            if (error) reject(error)
            else resolve()
        })
    })
}

afterEach(async () => {
    await stopServer()
})

describe('portProxy', () => {
    it('checks and fetches local HTTP ports with sanitized headers and base64 bodies', async () => {
        let port = 0
        port = await startServer(async (request, response) => {
            if (request.url === '/') {
                response.statusCode = 204
                response.end()
                return
            }

            const body = await readRequestBody(request)
            response.statusCode = 202
            response.statusMessage = 'Accepted'
            response.setHeader('content-type', 'application/json')
            response.setHeader('x-reply', 'ok')
            response.setHeader('location', `http://127.0.0.1:${port}/next`)
            response.end(JSON.stringify({
                method: request.method,
                url: request.url,
                body,
                xTest: request.headers['x-test'],
                connection: request.headers.connection,
                host: request.headers.host
            }))
        })

        await expect(checkPortProxyTarget({ port, targetHost: '127.0.0.1' })).resolves.toEqual({ success: true })

        const result = await fetchPortProxyTarget({
            port,
            targetHost: '127.0.0.1',
            method: 'POST',
            path: '/echo?x=1',
            headers: {
                'x-test': 'yes',
                connection: 'close',
                host: 'malicious-host'
            },
            bodyBase64: Buffer.from('hello').toString('base64')
        })

        expect(result.success).toBe(true)
        if (!result.success) return
        expect(result.status).toBe(202)
        expect(result.statusText).toBe('Accepted')
        expect(result.headers['x-reply']).toBe('ok')
        expect(result.headers.location).toBe(`http://127.0.0.1:${port}/next`)

        const payload = JSON.parse(Buffer.from(result.bodyBase64 ?? '', 'base64').toString('utf8')) as {
            method: string
            url: string
            body: string
            xTest: string
            connection?: string
            host?: string
        }
        expect(payload).toMatchObject({
            method: 'POST',
            url: '/echo?x=1',
            body: 'hello',
            xTest: 'yes'
        })
        expect(payload.host).not.toBe('malicious-host')
    })

    it('rejects non-local targets and unsafe paths', async () => {
        await expect(fetchPortProxyTarget({
            port: 8080,
            targetHost: '192.168.0.10',
            method: 'GET',
            path: '/'
        })).resolves.toMatchObject({
            success: false,
            error: expect.stringContaining('Only localhost')
        })

        await expect(fetchPortProxyTarget({
            port: 8080,
            targetHost: '127.0.0.1',
            method: 'GET',
            path: '//evil.example/'
        })).resolves.toMatchObject({
            success: false,
            error: expect.stringContaining('Invalid proxy path')
        })
    })
})
