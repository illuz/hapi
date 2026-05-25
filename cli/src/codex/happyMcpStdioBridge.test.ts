import { describe, expect, it } from 'vitest'
import {
    HAPI_MCP_BRIDGE_TOOL_NAMES,
    registerHappyMcpStdioBridgeTools
} from './happyMcpStdioBridge'
import {
    PROJECT_TOOLS_MCP_READ_TOOL_NAMES,
    PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES
} from '@/claude/utils/projectToolsMcp'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

describe('happyMcpStdioBridge', () => {
    it('registers change_title and project tools with the same public names as the HTTP MCP server', () => {
        const registered: Array<{
            name: string
            config: { inputSchema: { safeParse: (value: unknown) => { success: boolean } } }
            handler: (args: Record<string, unknown>) => Promise<unknown> | unknown
        }> = []

        registerHappyMcpStdioBridgeTools({
            registerTool: ((name: string, config: unknown, handler: unknown) => {
                registered.push({
                    name,
                    config: config as { inputSchema: { safeParse: (value: unknown) => { success: boolean } } },
                    handler: handler as (args: Record<string, unknown>) => Promise<unknown> | unknown
                })
                return {} as ReturnType<McpServer['registerTool']>
            }) as McpServer['registerTool']
        }, async () => ({
            callTool: async () => ({ content: [], isError: false })
        }))

        expect(registered.map((tool) => tool.name)).toEqual([
            'change_title',
            ...PROJECT_TOOLS_MCP_READ_TOOL_NAMES,
            ...PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES
        ])
        expect(HAPI_MCP_BRIDGE_TOOL_NAMES).toEqual(registered.map((tool) => tool.name))

        const upsertAgent = registered.find((tool) => tool.name === 'upsert_project_agent')
        expect(upsertAgent?.config.inputSchema.safeParse({
            projectPath: '/tmp/project',
            id: 'reviewer',
            value: {
                id: 'reviewer',
                prompt: 'Review the current diff.'
            }
        }).success).toBe(false)
    })

    it('forwards registered tool calls to the HTTP MCP server', async () => {
        const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
        const registered = new Map<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>()

        registerHappyMcpStdioBridgeTools({
            registerTool: ((name: string, _config: unknown, handler: unknown) => {
                registered.set(name, handler as (args: Record<string, unknown>) => Promise<unknown> | unknown)
                return {} as ReturnType<McpServer['registerTool']>
            }) as McpServer['registerTool']
        }, async () => ({
            callTool: async (request) => {
                calls.push(request as { name: string; arguments: Record<string, unknown> })
                return {
                    content: [{ type: 'text' as const, text: 'ok' }],
                    isError: false
                }
            }
        }))

        const handler = registered.get('upsert_project_cron')
        expect(handler).toBeDefined()
        const response = await handler?.({
            id: 'nightly',
            value: {
                id: 'nightly',
                prompt: 'Run nightly maintenance.',
                schedule: { type: 'manual' }
            }
        })

        expect(response).toEqual({
            content: [{ type: 'text', text: 'ok' }],
            isError: false
        })
        expect(calls).toEqual([
            {
                name: 'upsert_project_cron',
                arguments: {
                    id: 'nightly',
                    value: {
                        id: 'nightly',
                        prompt: 'Run nightly maintenance.',
                        schedule: { type: 'manual' }
                    }
                }
            }
        ])
    })
})
