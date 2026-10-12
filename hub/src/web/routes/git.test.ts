import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { RpcReadFileOptions, RpcReadSpreadsheetRangeOptions } from '../../sync/rpcGateway'
import type { WebAppEnv } from '../middleware/auth'
import { createGitRoutes } from './git'

function createSession(): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex'
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        markerColor: null,
        pinned: false,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default'
    }
}

function createApp(
    calls: Array<{ sessionId: string; path: string; options?: RpcReadFileOptions }>,
    spreadsheetCalls: Array<{ sessionId: string; path: string; options?: RpcReadSpreadsheetRangeOptions }> = []
) {
    const session = createSession()
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
        readSessionFile: async (sessionId: string, path: string, options?: RpcReadFileOptions) => {
            calls.push({ sessionId, path, options })
            return { success: true, content: 'thumbnail' }
        },
        readSessionSpreadsheetRange: async (
            sessionId: string,
            path: string,
            options?: RpcReadSpreadsheetRangeOptions
        ) => {
            spreadsheetCalls.push({ sessionId, path, options })
            return {
                success: true,
                sheet: options?.sheet,
                range: options?.range,
                startRow: 1,
                startColumn: 2,
                data: [['value']],
                truncated: false
            }
        }
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createGitRoutes(() => engine as SyncEngine))
    return app
}

describe('file routes', () => {
    it('forwards validated thumbnail options to the sync engine', async () => {
        const calls: Array<{ sessionId: string; path: string; options?: RpcReadFileOptions }> = []
        const app = createApp(calls)

        const response = await app.request(
            '/api/sessions/session-1/file?path=assets%2Flarge.png&thumbnail=true&maxDimension=640'
        )

        expect(response.status).toBe(200)
        expect(calls).toEqual([{
            sessionId: 'session-1',
            path: 'assets/large.png',
            options: { thumbnail: true, maxDimension: 640 }
        }])
    })

    it('rejects thumbnail dimensions outside the supported range', async () => {
        const calls: Array<{ sessionId: string; path: string; options?: RpcReadFileOptions }> = []
        const app = createApp(calls)

        const response = await app.request(
            '/api/sessions/session-1/file?path=assets%2Flarge.png&thumbnail=true&maxDimension=4096'
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid file request' })
        expect(calls).toEqual([])
    })

    it('forwards bounded spreadsheet range requests', async () => {
        const calls: Array<{ sessionId: string; path: string; options?: RpcReadFileOptions }> = []
        const spreadsheetCalls: Array<{ sessionId: string; path: string; options?: RpcReadSpreadsheetRangeOptions }> = []
        const app = createApp(calls, spreadsheetCalls)

        const response = await app.request(
            '/api/sessions/session-1/spreadsheet-range?path=docs%2Freport.xlsx&sheet=%E6%B1%87%E6%80%BB%E8%A1%A8&range=B1%3AX106'
        )

        expect(response.status).toBe(200)
        expect(spreadsheetCalls).toEqual([{
            sessionId: 'session-1',
            path: 'docs/report.xlsx',
            options: { sheet: '汇总表', range: 'B1:X106' }
        }])
        expect(await response.json()).toMatchObject({ success: true, sheet: '汇总表', range: 'B1:X106' })
    })
})
