import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'

type ReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

describe('file RPC handlers', () => {
    let sandboxDir: string
    let workingDirectory: string
    let temporaryArtifactPath: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-file-handler-'))
        workingDirectory = join(sandboxDir, 'workspace')
        temporaryArtifactPath = join(sandboxDir, 'donation-certificate-detail-v3.png')

        await mkdir(workingDirectory)
        await writeFile(join(workingDirectory, 'README.md'), '# workspace')
        await writeFile(temporaryArtifactPath, 'temporary image')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, workingDirectory)
    })

    afterEach(async () => {
        await rm(sandboxDir, { recursive: true, force: true })
    })

    async function read(path: string): Promise<ReadFileResponse> {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path })
        })
        return JSON.parse(response) as ReadFileResponse
    }

    it('reads files inside the session working directory', async () => {
        const result = await read('README.md')

        expect(result.success).toBe(true)
        expect(Buffer.from(result.content ?? '', 'base64').toString('utf8')).toBe('# workspace')
    })

    it('reads an absolute file from the system temporary directory', async () => {
        const result = await read(temporaryArtifactPath)

        expect(result.success).toBe(true)
        expect(Buffer.from(result.content ?? '', 'base64').toString('utf8')).toBe('temporary image')
    })

    it('rejects ordinary files outside the working and temporary directories', async () => {
        const result = await read(fileURLToPath(import.meta.url))

        expect(result.success).toBe(false)
    })

    it('rejects a temporary-directory symlink that resolves outside the temporary directory', async () => {
        const linkPath = join(sandboxDir, 'outside-link')
        try {
            await symlink(fileURLToPath(import.meta.url), linkPath, 'file')
        } catch {
            return
        }

        const result = await read(linkPath)

        expect(result.success).toBe(false)
    })
})
