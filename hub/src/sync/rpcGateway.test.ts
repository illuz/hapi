import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import { RpcGateway } from './rpcGateway'

function createGateway() {
    const timeouts: number[] = []
    const requests: Array<{ method: string; params: unknown }> = []
    const socket = {
        timeout(timeoutMs: number) {
            timeouts.push(timeoutMs)
            return {
                async emitWithAck(_event: string, payload: { method: string; params: string }) {
                    requests.push({
                        method: payload.method,
                        params: JSON.parse(payload.params) as unknown
                    })
                    return JSON.stringify({
                        success: true,
                        method: payload.method,
                        params: JSON.parse(payload.params) as unknown
                    })
                }
            }
        }
    }

    const io = {
        of() {
            return {
                sockets: {
                    get() {
                        return socket
                    }
                }
            }
        }
    } as unknown as Server

    const rpcRegistry = {
        getSocketIdForMethod() {
            return 'socket-1'
        }
    } as unknown as RpcRegistry

    return {
        gateway: new RpcGateway(io, rpcRegistry),
        timeouts,
        requests
    }
}

describe('RpcGateway RPC timeouts', () => {
    it('uses the default RPC timeout for regular machine RPCs', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listMachineDirectory('machine-1', 'C:\\workspace')

        expect(timeouts).toEqual([30_000])
    })

    it('uses an extended RPC timeout when listing Codex models', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCodexModelsForMachine('machine-1')

        expect(timeouts).toEqual([120_000])
    })

    it('forwards thumbnail options when reading a session file', async () => {
        const { gateway, requests } = createGateway()

        await gateway.readSessionFile('session-1', 'image.png', {
            thumbnail: true,
            maxDimension: 640
        })

        expect(requests).toEqual([{
            method: 'session-1:readFile',
            params: {
                path: 'image.png',
                thumbnail: true,
                maxDimension: 640
            }
        }])
    })
})
