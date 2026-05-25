import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    countProjectTools,
    deleteProjectTool,
    listProjectTools,
    upsertProjectTool
} from './projectToolsFs'

describe('projectToolsFs', () => {
    let sandboxDir: string
    let workspaceRoot: string
    let projectPath: string

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-project-tools-'))
        workspaceRoot = join(sandboxDir, 'workspace')
        projectPath = join(workspaceRoot, 'project')
        await mkdir(projectPath, { recursive: true })
    })

    afterEach(async () => {
        await rm(sandboxDir, { recursive: true, force: true })
    })

    function agentConfig(id = 'reviewer', prompt = 'Review the current diff.') {
        return {
            id,
            name: 'Reviewer',
            prompt,
            agent: 'codex' as const,
            permissionMode: 'acceptEdits' as const
        }
    }

    function cronConfig(id = 'nightly') {
        return {
            id,
            name: 'Nightly',
            prompt: 'Run nightly maintenance.',
            schedule: { type: 'manual' as const }
        }
    }

    it('creates, lists, counts, updates, and deletes project tools through resolved paths', async () => {
        const createdAgent = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig()
        })
        expect(createdAgent.success).toBe(true)
        expect(createdAgent.success ? createdAgent.hash : undefined).toMatch(/^[a-f0-9]{64}$/)

        const createdCron = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'cron',
            id: 'nightly',
            value: cronConfig()
        })
        expect(createdCron.success).toBe(true)

        const list = await listProjectTools({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent'
        })
        expect(list.success).toBe(true)
        expect(list.success ? list.items.map((item) => item.id) : []).toEqual(['reviewer'])
        expect(list.success ? list.items[0]?.config.prompt : undefined).toBe('Review the current diff.')

        const counts = await countProjectTools({ workspaceRoots: [workspaceRoot], projectPath })
        expect(counts).toMatchObject({
            success: true,
            counts: {
                agents: 1,
                crons: 1
            }
        })

        const updated = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig('reviewer', 'Review and fix the current diff.'),
            expectedHash: createdAgent.success ? createdAgent.hash : undefined
        })
        expect(updated.success).toBe(true)
        expect(updated.success && createdAgent.success ? updated.hash : undefined).not.toBe(
            createdAgent.success ? createdAgent.hash : undefined
        )

        const deleted = await deleteProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            expectedHash: updated.success ? updated.hash : undefined
        })
        expect(deleted.success).toBe(true)

        const afterDelete = await listProjectTools({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent'
        })
        expect(afterDelete.success ? afterDelete.items : []).toEqual([])
    })

    it('rejects ids containing path separators, traversal, json extension, or only whitespace', async () => {
        for (const id of ['bad/id', 'bad\\id', '..', 'bad.json', '   ']) {
            const result = await upsertProjectTool({
                workspaceRoots: [workspaceRoot],
                projectPath,
                kind: 'agent',
                id,
                value: { ...agentConfig('safe'), id }
            })

            expect(result.success, `expected ${JSON.stringify(id)} to be rejected`).toBe(false)
        }
    })

    it('rejects project paths outside workspace roots', async () => {
        const outsideProject = join(sandboxDir, 'outside-project')
        await mkdir(outsideProject, { recursive: true })

        const result = await listProjectTools({
            workspaceRoots: [workspaceRoot],
            projectPath: outsideProject,
            kind: 'agent'
        })

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('outside workspace roots')
        })
    })

    it('allows project tool access when workspaceRoots is empty', async () => {
        const result = await upsertProjectTool({
            workspaceRoots: [],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig()
        })

        expect(result.success).toBe(true)

        const list = await listProjectTools({
            workspaceRoots: [],
            projectPath,
            kind: 'agent'
        })
        expect(list.success ? list.items.map((item) => item.id) : []).toEqual(['reviewer'])
    })

    it('rejects symlink project paths', async () => {
        const realProject = join(workspaceRoot, 'real-project')
        const linkProject = join(workspaceRoot, 'link-project')
        await mkdir(realProject, { recursive: true })

        try {
            await symlink(realProject, linkProject, 'dir')
        } catch {
            return
        }

        const result = await listProjectTools({
            workspaceRoots: [workspaceRoot],
            projectPath: linkProject,
            kind: 'agent'
        })

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('symlink')
        })
    })

    it('rejects symlink .hapi tool directories instead of following writes', async () => {
        const outsideAgentsDir = join(sandboxDir, 'outside-agents')
        await mkdir(outsideAgentsDir, { recursive: true })
        await mkdir(join(projectPath, '.hapi'), { recursive: true })

        try {
            await symlink(outsideAgentsDir, join(projectPath, '.hapi', 'agents'), 'dir')
        } catch {
            return
        }

        const result = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig()
        })

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('symlink')
        })

        await expect(readFile(join(outsideAgentsDir, 'reviewer.json'), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT'
        })
    })

    it('rejects symlink tool files instead of overwriting the link target', async () => {
        const outsideFile = join(sandboxDir, 'outside-agent.json')
        await mkdir(join(projectPath, '.hapi', 'agents'), { recursive: true })
        await writeFile(outsideFile, 'outside')

        try {
            await symlink(outsideFile, join(projectPath, '.hapi', 'agents', 'reviewer.json'))
        } catch {
            return
        }

        const result = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig()
        })

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('symlink')
        })
        await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
    })

    it('rejects expectedHash mismatches', async () => {
        const created = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig()
        })
        expect(created.success).toBe(true)

        const result = await upsertProjectTool({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent',
            id: 'reviewer',
            value: agentConfig('reviewer', 'Changed prompt.'),
            expectedHash: '0'.repeat(64)
        })

        expect(result).toMatchObject({
            success: false,
            error: expect.stringContaining('hash mismatch')
        })
    })

    it('reports malformed files without failing the whole list', async () => {
        await mkdir(join(projectPath, '.hapi', 'agents'), { recursive: true })
        await writeFile(join(projectPath, '.hapi', 'agents', 'broken.json'), '{bad json')

        const result = await listProjectTools({
            workspaceRoots: [workspaceRoot],
            projectPath,
            kind: 'agent'
        })

        expect(result.success).toBe(true)
        expect(result.success ? result.items : []).toEqual([])
        expect(result.success ? result.errors?.[0]?.id : undefined).toBe('broken')
    })
})
