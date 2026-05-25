import { z } from 'zod'
import {
    ProjectAgentConfigSchema,
    ProjectCronConfigSchema,
    ProjectToolIdSchema,
    type ProjectToolKind
} from '@hapi/protocol/projectTools'
import {
    listProjectTools,
    upsertProjectTool,
    type ProjectToolFsListResult,
    type ProjectToolFsMutationResult
} from '@/modules/common/projectToolsFs'

type McpToolResponse = {
    content: Array<{ type: 'text'; text: string }>
    isError: boolean
}

type ProjectToolsMcpServer = {
    registerTool(
        name: string,
        config: {
            description: string
            title: string
            inputSchema: z.ZodTypeAny
        },
        handler: (args: unknown) => Promise<McpToolResponse> | McpToolResponse
    ): void
}

type ProjectToolsListFn = typeof listProjectTools
type ProjectToolsUpsertFn = typeof upsertProjectTool

export interface RegisterProjectToolsMcpDeps {
    getProjectPath: () => string | null
    getWorkspaceRoots?: () => string[] | undefined
    listProjectTools?: ProjectToolsListFn
    upsertProjectTool?: ProjectToolsUpsertFn
    logger?: {
        debug: (...args: unknown[]) => void
    }
}

export interface ProjectToolsMcpToolDefinition {
    name: 'list_project_agents' | 'list_project_cron' | 'upsert_project_agent' | 'upsert_project_cron'
    kind: ProjectToolKind
    access: 'read' | 'write'
    title: string
    description: string
    inputSchema: z.ZodTypeAny
}

const listInputSchema: z.ZodTypeAny = z.object({}).strict()

const upsertAgentInputSchema: z.ZodTypeAny = z.object({
    id: ProjectToolIdSchema.describe('Project agent id. Must match value.id.'),
    value: ProjectAgentConfigSchema.describe('Project agent config to create or update.'),
    expectedHash: z.string().optional().nullable().describe('Optional optimistic concurrency hash from list_project_agents.')
}).strict()

const upsertCronInputSchema: z.ZodTypeAny = z.object({
    id: ProjectToolIdSchema.describe('Project cron id. Must match value.id.'),
    value: ProjectCronConfigSchema.describe('Project cron config to create or update.'),
    expectedHash: z.string().optional().nullable().describe('Optional optimistic concurrency hash from list_project_cron.')
}).strict()

export const projectToolsMcpToolDefinitions: ProjectToolsMcpToolDefinition[] = [
    {
        name: 'list_project_agents',
        kind: 'agent',
        access: 'read',
        title: 'List Project Agents',
        description: 'List HAPI project agents in the current session project. Does not accept a project path.',
        inputSchema: listInputSchema
    },
    {
        name: 'list_project_cron',
        kind: 'cron',
        access: 'read',
        title: 'List Project Cron',
        description: 'List HAPI project cron jobs in the current session project. Does not accept a project path.',
        inputSchema: listInputSchema
    },
    {
        name: 'upsert_project_agent',
        kind: 'agent',
        access: 'write',
        title: 'Upsert Project Agent',
        description: 'Create or update a HAPI project agent in the current session project .hapi/agents directory.',
        inputSchema: upsertAgentInputSchema
    },
    {
        name: 'upsert_project_cron',
        kind: 'cron',
        access: 'write',
        title: 'Upsert Project Cron',
        description: 'Create or update a HAPI project cron job in the current session project .hapi/cron directory.',
        inputSchema: upsertCronInputSchema
    }
]

export const PROJECT_TOOLS_MCP_READ_TOOL_NAMES = projectToolsMcpToolDefinitions
    .filter((tool) => tool.access === 'read')
    .map((tool) => tool.name)

export const PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES = projectToolsMcpToolDefinitions
    .filter((tool) => tool.access === 'write')
    .map((tool) => tool.name)

function textResponse(text: string, isError = false): McpToolResponse {
    return {
        content: [{ type: 'text', text }],
        isError
    }
}

function jsonResponse(value: unknown, isError = false): McpToolResponse {
    return textResponse(JSON.stringify(value, null, 2), isError)
}

function formatZodError(error: z.ZodError): string {
    return error.issues.map((issue) => {
        const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
        return `${path}${issue.message}`
    }).join('; ')
}

function getToolRelativePath(kind: ProjectToolKind, id: string): string {
    return kind === 'agent'
        ? `.hapi/agents/${id}.json`
        : `.hapi/cron/${id}.json`
}

function sanitizeListResult(result: ProjectToolFsListResult): unknown {
    if (!result.success) {
        return result
    }

    return {
        success: true,
        kind: result.kind,
        items: result.items.map((item) => ({
            kind: item.kind,
            id: item.id,
            path: getToolRelativePath(item.kind, item.id),
            config: item.config,
            value: item.value,
            hash: item.hash,
            updatedAt: item.updatedAt
        })),
        errors: result.errors?.map((error) => ({
            id: error.id,
            path: error.id ? getToolRelativePath(result.kind, error.id) : undefined,
            error: error.error
        }))
    }
}

function sanitizeMutationResult(result: ProjectToolFsMutationResult): unknown {
    if (!result.success) {
        return result
    }

    return {
        success: true,
        kind: result.kind,
        id: result.id,
        path: getToolRelativePath(result.kind, result.id),
        hash: result.hash,
        item: result.item
            ? {
                kind: result.item.kind,
                id: result.item.id,
                path: getToolRelativePath(result.item.kind, result.item.id),
                config: result.item.config,
                value: result.item.value,
                hash: result.item.hash,
                updatedAt: result.item.updatedAt
            }
            : undefined
    }
}

function resolveProjectContext(deps: RegisterProjectToolsMcpDeps): {
    projectPath: string
    workspaceRoots: string[]
} | McpToolResponse {
    const projectPath = deps.getProjectPath()
    if (!projectPath) {
        return textResponse('Current session project path is unavailable.', true)
    }

    return {
        projectPath,
        workspaceRoots: deps.getWorkspaceRoots?.() ?? [projectPath]
    }
}

function getDefinition(name: string): ProjectToolsMcpToolDefinition | null {
    return projectToolsMcpToolDefinitions.find((definition) => definition.name === name) ?? null
}

export async function handleProjectToolsMcpToolCall(
    name: string,
    args: unknown,
    deps: RegisterProjectToolsMcpDeps
): Promise<McpToolResponse> {
    const definition = getDefinition(name)
    if (!definition) {
        return textResponse(`Unknown project tools MCP tool: ${name}`, true)
    }

    const parsedArgs = definition.inputSchema.safeParse(args ?? {})
    if (!parsedArgs.success) {
        return textResponse(`Invalid ${name} arguments: ${formatZodError(parsedArgs.error)}`, true)
    }

    const context = resolveProjectContext(deps)
    if ('isError' in context) {
        return context
    }

    try {
        if (definition.access === 'read') {
            const listFn = deps.listProjectTools ?? listProjectTools
            const result = await listFn({
                workspaceRoots: context.workspaceRoots,
                projectPath: context.projectPath,
                kind: definition.kind
            })

            return jsonResponse(sanitizeListResult(result), !result.success)
        }

        const input = parsedArgs.data as { id: string; value: unknown; expectedHash?: string | null }
        const upsertFn = deps.upsertProjectTool ?? upsertProjectTool
        const result = await upsertFn({
            workspaceRoots: context.workspaceRoots,
            projectPath: context.projectPath,
            kind: definition.kind,
            id: input.id,
            value: input.value,
            expectedHash: input.expectedHash
        })

        return jsonResponse(sanitizeMutationResult(result), !result.success)
    } catch (error) {
        deps.logger?.debug('[projectToolsMCP] Tool failed', { name, error })
        return textResponse(error instanceof Error ? error.message : String(error), true)
    }
}

export function registerProjectToolsMcpTools(
    mcp: ProjectToolsMcpServer,
    deps: RegisterProjectToolsMcpDeps
): {
    toolNames: string[]
    readToolNames: string[]
    writeToolNames: string[]
} {
    for (const definition of projectToolsMcpToolDefinitions) {
        mcp.registerTool(
            definition.name,
            {
                description: definition.description,
                title: definition.title,
                inputSchema: definition.inputSchema
            },
            async (args: unknown) => handleProjectToolsMcpToolCall(definition.name, args, deps)
        )
    }

    return {
        toolNames: projectToolsMcpToolDefinitions.map((tool) => tool.name),
        readToolNames: [...PROJECT_TOOLS_MCP_READ_TOOL_NAMES],
        writeToolNames: [...PROJECT_TOOLS_MCP_WRITE_TOOL_NAMES]
    }
}
