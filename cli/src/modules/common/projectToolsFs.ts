import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
    ProjectAgentConfigSchema,
    ProjectCronConfigSchema,
    ProjectToolIdSchema,
    ProjectToolKindSchema,
    type ProjectAgentConfig,
    type ProjectCronConfig,
    type ProjectToolId,
    type ProjectToolKind
} from '@hapi/protocol/projectTools'
import { isWithinPathRoot } from './pathSecurity'

type ProjectToolConfig = ProjectAgentConfig | ProjectCronConfig

interface ProjectToolFsBaseRequest {
    workspaceRoots: string[] | undefined
    projectPath: string
}

export interface ProjectToolFsKindRequest extends ProjectToolFsBaseRequest {
    kind: ProjectToolKind
}

export interface ProjectToolFsIdRequest extends ProjectToolFsKindRequest {
    id: string
    expectedHash?: string | null
}

export interface ProjectToolFsUpsertRequest extends ProjectToolFsIdRequest {
    value?: unknown
    config?: unknown
}

export interface ProjectToolFsItem<TConfig extends ProjectToolConfig = ProjectToolConfig> {
    kind: ProjectToolKind
    id: ProjectToolId
    path: string
    config: TConfig
    value: TConfig
    hash: string
    updatedAt?: number
}

export interface ProjectToolFsFileError {
    path: string
    id?: string
    error: string
}

export type ProjectToolFsListResult = {
    success: true
    kind: ProjectToolKind
    projectPath: string
    items: ProjectToolFsItem[]
    errors?: ProjectToolFsFileError[]
} | {
    success: false
    error: string
}

export type ProjectToolFsCountsResult = {
    success: true
    projectPath: string
    counts: {
        agents: number
        crons: number
    }
    errors?: ProjectToolFsFileError[]
} | {
    success: false
    error: string
}

export type ProjectToolFsMutationResult = {
    success: true
    kind: ProjectToolKind
    projectPath: string
    id: ProjectToolId
    item?: ProjectToolFsItem
    hash?: string
} | {
    success: false
    error: string
}

interface ProjectToolContext {
    projectPath: string
    hapiDir: string
}

interface ExistingToolFile {
    exists: boolean
    hash?: string
    buffer?: Buffer
    updatedAt?: number
}

function formatError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

function isNotFound(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex')
}

function stringifyConfig(config: ProjectToolConfig): Buffer {
    return Buffer.from(`${JSON.stringify(config, null, 4)}\n`, 'utf8')
}

function toolDirectoryName(kind: ProjectToolKind): 'agents' | 'cron' {
    return kind === 'agent' ? 'agents' : 'cron'
}

function parseKind(kind: unknown): ProjectToolKind {
    const parsed = ProjectToolKindSchema.safeParse(kind)
    if (!parsed.success) {
        throw new Error('Invalid project tool kind')
    }
    return parsed.data
}

function parseId(id: unknown): ProjectToolId {
    const parsed = ProjectToolIdSchema.safeParse(id)
    if (!parsed.success) {
        throw new Error('Invalid project tool id')
    }
    return parsed.data
}

function parseConfig(kind: ProjectToolKind, id: ProjectToolId, config: unknown): ProjectToolConfig {
    const parsed = kind === 'agent'
        ? ProjectAgentConfigSchema.safeParse(config)
        : ProjectCronConfigSchema.safeParse(config)

    if (!parsed.success) {
        const message = parsed.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(message ? `Invalid project tool config: ${message}` : 'Invalid project tool config')
    }

    if (parsed.data.id !== id) {
        throw new Error('Project tool config id must match request id')
    }

    return parsed.data
}

async function canonicalizeWorkspaceRoots(workspaceRoots: string[] | undefined): Promise<string[] | null> {
    if (!workspaceRoots?.length) {
        return null
    }

    const roots: string[] = []
    for (const rawRoot of workspaceRoots) {
        const root = typeof rawRoot === 'string' ? rawRoot.trim() : ''
        if (!root) continue
        if (!isAbsolute(root)) {
            throw new Error('workspaceRoots must be absolute paths')
        }

        try {
            const stats = await lstat(root)
            if (stats.isSymbolicLink()) {
                throw new Error(`Workspace root must not be a symlink: ${root}`)
            }
            if (!stats.isDirectory()) {
                throw new Error(`Workspace root is not a directory: ${root}`)
            }
            roots.push(await realpath(root))
        } catch (error) {
            if (isNotFound(error)) {
                throw new Error(`Workspace root does not exist: ${root}`)
            }
            throw error
        }
    }

    const uniqueRoots = Array.from(new Set(roots))
    if (!uniqueRoots.length) {
        return null
    }
    return uniqueRoots
}

async function resolveProjectContext(request: ProjectToolFsBaseRequest): Promise<ProjectToolContext> {
    const rawProjectPath = typeof request.projectPath === 'string' ? request.projectPath.trim() : ''
    if (!rawProjectPath) {
        throw new Error('projectPath is required')
    }
    if (!isAbsolute(rawProjectPath)) {
        throw new Error('projectPath must be an absolute path')
    }

    const workspaceRoots = await canonicalizeWorkspaceRoots(request.workspaceRoots)
    const projectStats = await lstat(rawProjectPath)
    if (projectStats.isSymbolicLink()) {
        throw new Error('Project path must not be a symlink')
    }
    if (!projectStats.isDirectory()) {
        throw new Error('Project path is not a directory')
    }

    const projectPath = await realpath(rawProjectPath)
    if (workspaceRoots && !workspaceRoots.some((root) => isWithinPathRoot(projectPath, root))) {
        throw new Error('Project path is outside workspace roots')
    }

    return {
        projectPath,
        hapiDir: join(projectPath, '.hapi')
    }
}

async function ensureDirectory(path: string, label: string, create: boolean): Promise<boolean> {
    try {
        const stats = await lstat(path)
        if (stats.isSymbolicLink()) {
            throw new Error(`${label} must not be a symlink`)
        }
        if (!stats.isDirectory()) {
            throw new Error(`${label} is not a directory`)
        }
        return true
    } catch (error) {
        if (!isNotFound(error)) {
            throw error
        }
        if (!create) {
            return false
        }
    }

    await mkdir(path)
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink`)
    }
    if (!stats.isDirectory()) {
        throw new Error(`${label} is not a directory`)
    }
    return true
}

async function resolveToolDirectory(context: ProjectToolContext, kind: ProjectToolKind, create: boolean): Promise<string | null> {
    const hasHapiDir = await ensureDirectory(context.hapiDir, '.hapi directory', create)
    if (!hasHapiDir) {
        return null
    }

    const toolDir = join(context.hapiDir, toolDirectoryName(kind))
    if (!isWithinPathRoot(toolDir, context.hapiDir)) {
        throw new Error('Resolved project tool directory escaped .hapi')
    }

    const hasToolDir = await ensureDirectory(toolDir, `${toolDirectoryName(kind)} directory`, create)
    return hasToolDir ? toolDir : null
}

function resolveToolFilePath(toolDir: string, id: ProjectToolId): string {
    const filePath = join(toolDir, `${id}.json`)
    if (!isWithinPathRoot(filePath, toolDir)) {
        throw new Error('Resolved project tool file escaped tool directory')
    }
    return filePath
}

async function readExistingToolFile(filePath: string): Promise<ExistingToolFile> {
    try {
        const stats = await lstat(filePath)
        if (stats.isSymbolicLink()) {
            throw new Error('Project tool file must not be a symlink')
        }
        if (!stats.isFile()) {
            throw new Error('Project tool path is not a file')
        }

        const buffer = await readFile(filePath)
        return {
            exists: true,
            buffer,
            hash: hashBuffer(buffer),
            updatedAt: stats.mtime.getTime()
        }
    } catch (error) {
        if (isNotFound(error)) {
            return { exists: false }
        }
        throw error
    }
}

function createItem(
    kind: ProjectToolKind,
    id: ProjectToolId,
    filePath: string,
    config: ProjectToolConfig,
    hash: string,
    updatedAt?: number
): ProjectToolFsItem {
    return {
        kind,
        id,
        path: filePath,
        config,
        value: config,
        hash,
        updatedAt
    }
}

export async function listProjectTools(request: ProjectToolFsKindRequest): Promise<ProjectToolFsListResult> {
    try {
        const kind = parseKind(request.kind)
        const context = await resolveProjectContext(request)
        const toolDir = await resolveToolDirectory(context, kind, false)
        if (!toolDir) {
            return {
                success: true,
                kind,
                projectPath: context.projectPath,
                items: []
            }
        }

        const entries = await readdir(toolDir, { withFileTypes: true })
        const items: ProjectToolFsItem[] = []
        const errors: ProjectToolFsFileError[] = []

        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (extname(entry.name) !== '.json') {
                continue
            }

            const id = ProjectToolIdSchema.safeParse(basename(entry.name, '.json'))
            const filePath = join(toolDir, entry.name)
            if (!isWithinPathRoot(filePath, toolDir)) {
                errors.push({ path: filePath, error: 'Project tool file escaped tool directory' })
                continue
            }
            if (!id.success) {
                errors.push({ path: filePath, error: 'Invalid project tool filename' })
                continue
            }

            try {
                const existing = await readExistingToolFile(filePath)
                if (!existing.exists || !existing.buffer || !existing.hash) {
                    errors.push({ path: filePath, id: id.data, error: 'Project tool file does not exist' })
                    continue
                }

                const parsedJson = JSON.parse(existing.buffer.toString('utf8')) as unknown
                const config = parseConfig(kind, id.data, parsedJson)
                items.push(createItem(kind, id.data, filePath, config, existing.hash, existing.updatedAt))
            } catch (error) {
                errors.push({
                    path: filePath,
                    id: id.success ? id.data : undefined,
                    error: formatError(error, 'Failed to read project tool file')
                })
            }
        }

        return {
            success: true,
            kind,
            projectPath: context.projectPath,
            items,
            errors: errors.length ? errors : undefined
        }
    } catch (error) {
        return {
            success: false,
            error: formatError(error, 'Failed to list project tools')
        }
    }
}

export async function countProjectTools(request: ProjectToolFsBaseRequest): Promise<ProjectToolFsCountsResult> {
    const agents = await listProjectTools({ ...request, kind: 'agent' })
    if (!agents.success) {
        return agents
    }

    const crons = await listProjectTools({ ...request, kind: 'cron' })
    if (!crons.success) {
        return crons
    }

    return {
        success: true,
        projectPath: agents.projectPath,
        counts: {
            agents: agents.items.length,
            crons: crons.items.length
        },
        errors: [...(agents.errors ?? []), ...(crons.errors ?? [])].length
            ? [...(agents.errors ?? []), ...(crons.errors ?? [])]
            : undefined
    }
}

export async function upsertProjectTool(request: ProjectToolFsUpsertRequest): Promise<ProjectToolFsMutationResult> {
    let tempPath: string | null = null

    try {
        const kind = parseKind(request.kind)
        const id = parseId(request.id)
        const config = parseConfig(kind, id, request.value ?? request.config)
        const context = await resolveProjectContext(request)
        const toolDir = await resolveToolDirectory(context, kind, true)
        if (!toolDir) {
            throw new Error('Project tool directory could not be created')
        }

        const filePath = resolveToolFilePath(toolDir, id)
        const existing = await readExistingToolFile(filePath)
        if (request.expectedHash !== undefined && request.expectedHash !== null) {
            if (!existing.exists || !existing.hash) {
                throw new Error('Project tool file does not exist but expectedHash was provided')
            }
            if (existing.hash !== request.expectedHash) {
                throw new Error(`Project tool hash mismatch. Expected: ${request.expectedHash}, Actual: ${existing.hash}`)
            }
        }

        const buffer = stringifyConfig(config)
        const hash = hashBuffer(buffer)
        tempPath = join(toolDir, `.${id}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)
        if (!isWithinPathRoot(tempPath, toolDir)) {
            throw new Error('Resolved temp file escaped tool directory')
        }

        const handle = await open(tempPath, 'wx')
        try {
            await handle.writeFile(buffer)
        } finally {
            await handle.close()
        }

        const beforeRename = await readExistingToolFile(filePath)
        if (request.expectedHash !== undefined && request.expectedHash !== null) {
            if (!beforeRename.exists || beforeRename.hash !== request.expectedHash) {
                throw new Error('Project tool file changed before write')
            }
        }

        await rename(tempPath, filePath)
        tempPath = null

        const written = await readExistingToolFile(filePath)
        if (!written.exists || !written.hash) {
            throw new Error('Project tool file was not written')
        }

        return {
            success: true,
            kind,
            projectPath: context.projectPath,
            id,
            hash,
            item: createItem(kind, id, filePath, config, written.hash, written.updatedAt)
        }
    } catch (error) {
        if (tempPath) {
            await rm(tempPath, { force: true }).catch(() => undefined)
        }

        return {
            success: false,
            error: formatError(error, 'Failed to upsert project tool')
        }
    }
}

export async function deleteProjectTool(request: ProjectToolFsIdRequest): Promise<ProjectToolFsMutationResult> {
    try {
        const kind = parseKind(request.kind)
        const id = parseId(request.id)
        const context = await resolveProjectContext(request)
        const toolDir = await resolveToolDirectory(context, kind, false)
        if (!toolDir) {
            throw new Error('Project tool file does not exist')
        }

        const filePath = resolveToolFilePath(toolDir, id)
        const existing = await readExistingToolFile(filePath)
        if (!existing.exists || !existing.hash) {
            throw new Error('Project tool file does not exist')
        }
        if (request.expectedHash !== undefined && request.expectedHash !== null && existing.hash !== request.expectedHash) {
            throw new Error(`Project tool hash mismatch. Expected: ${request.expectedHash}, Actual: ${existing.hash}`)
        }

        await unlink(filePath)

        return {
            success: true,
            kind,
            projectPath: context.projectPath,
            id
        }
    } catch (error) {
        return {
            success: false,
            error: formatError(error, 'Failed to delete project tool')
        }
    }
}
