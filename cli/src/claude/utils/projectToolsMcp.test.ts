import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    handleProjectToolsMcpToolCall,
    PROJECT_TOOLS_MCP_READ_TOOL_NAMES,
    PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES,
    projectToolsMcpToolDefinitions,
    registerProjectToolsMcpTools
} from './projectToolsMcp'

describe('projectToolsMcp', () => {
    let sandboxDir: string
    let projectPath: string

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-project-tools-mcp-'))
        projectPath = join(sandboxDir, 'project')
        await mkdir(projectPath, { recursive: true })
    })

    afterEach(async () => {
        await rm(sandboxDir, { recursive: true, force: true })
    })

    function agentValue(id = 'reviewer') {
        return {
            id,
            name: 'Reviewer',
            prompt: 'Review the current diff.',
            agent: 'codex' as const,
            permissionMode: 'acceptEdits' as const
        }
    }

    function cronValue(id = 'nightly') {
        return {
            id,
            name: 'Nightly',
            prompt: 'Run nightly maintenance.',
            schedule: { type: 'manual' as const }
        }
    }

    function parseToolText(response: Awaited<ReturnType<typeof handleProjectToolsMcpToolCall>>) {
        return JSON.parse(response.content[0]?.text ?? 'null') as unknown
    }

    it('exposes read and write tool groups without default-allowing writes', () => {
        expect(PROJECT_TOOLS_MCP_READ_TOOL_NAMES).toEqual(['list_project_agents', 'list_project_cron'])
        expect(PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES).toEqual(['upsert_project_agent', 'upsert_project_cron'])

        const registered: string[] = []
        const result = registerProjectToolsMcpTools({
            registerTool: (name) => {
                registered.push(name)
            }
        }, {
            getProjectPath: () => projectPath
        })

        expect(registered).toEqual([
            'list_project_agents',
            'list_project_cron',
            'upsert_project_agent',
            'upsert_project_cron'
        ])
        expect(result.toolNames).toEqual(registered)
        expect(result.readToolNames).toEqual(PROJECT_TOOLS_MCP_READ_TOOL_NAMES)
        expect(result.writeToolNames).toEqual(PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES)
    })

    it('does not include projectPath in any MCP input schema', () => {
        for (const definition of projectToolsMcpToolDefinitions) {
            const parsed = definition.inputSchema.safeParse({
                projectPath,
                id: 'reviewer',
                value: definition.kind === 'agent' ? agentValue() : cronValue('reviewer')
            })

            expect(parsed.success, `${definition.name} should reject projectPath`).toBe(false)
        }
    })

    it('returns an error when current session project path is unavailable', async () => {
        const response = await handleProjectToolsMcpToolCall('list_project_agents', {}, {
            getProjectPath: () => null
        })

        expect(response.isError).toBe(true)
        expect(response.content[0]?.text).toContain('Current session project path is unavailable')
    })

    it('upserts and lists project agents through the safe project tools file layer', async () => {
        const upserted = await handleProjectToolsMcpToolCall('upsert_project_agent', {
            id: 'reviewer',
            value: agentValue()
        }, {
            getProjectPath: () => projectPath
        })

        expect(upserted.isError).toBe(false)
        const upsertPayload = parseToolText(upserted) as {
            success: boolean
            path: string
            hash?: string
        }
        expect(upsertPayload).toMatchObject({
            success: true,
            path: '.hapi/agents/reviewer.json'
        })
        expect(upsertPayload.hash).toMatch(/^[a-f0-9]{64}$/)

        const written = JSON.parse(await readFile(join(projectPath, '.hapi', 'agents', 'reviewer.json'), 'utf8')) as unknown
        expect(written).toMatchObject(agentValue())

        const listed = await handleProjectToolsMcpToolCall('list_project_agents', {}, {
            getProjectPath: () => projectPath
        })

        expect(listed.isError).toBe(false)
        const listPayload = parseToolText(listed) as { success: boolean; items: Array<{ id: string; path: string }> }
        expect(listPayload.success).toBe(true)
        expect(listPayload.items).toEqual([
            expect.objectContaining({
                id: 'reviewer',
                path: '.hapi/agents/reviewer.json'
            })
        ])
    })

    it('upserts and lists project cron through the current project path only', async () => {
        const upserted = await handleProjectToolsMcpToolCall('upsert_project_cron', {
            id: 'nightly',
            value: cronValue()
        }, {
            getProjectPath: () => projectPath
        })

        expect(upserted.isError).toBe(false)
        const upsertPayload = parseToolText(upserted) as { success: boolean; path: string }
        expect(upsertPayload).toMatchObject({
            success: true,
            path: '.hapi/cron/nightly.json'
        })

        const listed = await handleProjectToolsMcpToolCall('list_project_cron', {}, {
            getProjectPath: () => projectPath
        })

        expect(listed.isError).toBe(false)
        const listPayload = parseToolText(listed) as { success: boolean; items: Array<{ id: string; path: string }> }
        expect(listPayload.success).toBe(true)
        expect(listPayload.items).toEqual([
            expect.objectContaining({
                id: 'nightly',
                path: '.hapi/cron/nightly.json'
            })
        ])
    })

    it('rejects value id mismatch before writing', async () => {
        const response = await handleProjectToolsMcpToolCall('upsert_project_agent', {
            id: 'reviewer',
            value: agentValue('other')
        }, {
            getProjectPath: () => projectPath
        })

        expect(response.isError).toBe(true)
        expect(response.content[0]?.text).toContain('id must match request id')
    })
})
