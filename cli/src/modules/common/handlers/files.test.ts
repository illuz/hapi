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
    mimeType?: string
    width?: number
    height?: number
    error?: string
}

type ReadFileOptions = {
    thumbnail?: boolean
    maxDimension?: number
}

function createBmp(width: number, height: number): Buffer {
    const rowSize = Math.ceil((width * 3) / 4) * 4
    const pixelDataSize = rowSize * height
    const buffer = Buffer.alloc(54 + pixelDataSize)

    buffer.write('BM', 0, 'ascii')
    buffer.writeUInt32LE(buffer.length, 2)
    buffer.writeUInt32LE(54, 10)
    buffer.writeUInt32LE(40, 14)
    buffer.writeInt32LE(width, 18)
    buffer.writeInt32LE(height, 22)
    buffer.writeUInt16LE(1, 26)
    buffer.writeUInt16LE(24, 28)
    buffer.writeUInt32LE(pixelDataSize, 34)

    for (let y = 0; y < height; y += 1) {
        const rowOffset = 54 + y * rowSize
        for (let x = 0; x < width; x += 1) {
            const offset = rowOffset + x * 3
            buffer[offset] = (x * 17 + y * 13) % 256
            buffer[offset + 1] = (x * 7 + y * 19) % 256
            buffer[offset + 2] = (x * 23 + y * 5) % 256
        }
    }

    return buffer
}

const LARGE_IMAGE = createBmp(1280, 640)

describe('file RPC handlers', () => {
    let sandboxDir: string
    let workingDirectory: string
    let temporaryArtifactPath: string
    let largeImagePath: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-file-handler-'))
        workingDirectory = join(sandboxDir, 'workspace')
        temporaryArtifactPath = join(sandboxDir, 'donation-certificate-detail-v3.png')
        largeImagePath = join(workingDirectory, 'large-image.bmp')

        await mkdir(workingDirectory)
        await writeFile(join(workingDirectory, 'README.md'), '# workspace')
        await writeFile(temporaryArtifactPath, 'temporary image')

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, workingDirectory)
    })

    afterEach(async () => {
        await rm(sandboxDir, { recursive: true, force: true })
    })

    async function read(path: string, options?: ReadFileOptions): Promise<ReadFileResponse> {
        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path, ...options })
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

    it('returns a compact thumbnail instead of the original image', async () => {
        await writeFile(largeImagePath, LARGE_IMAGE)

        const result = await read(largeImagePath, { thumbnail: true, maxDimension: 640 })
        const thumbnail = Buffer.from(result.content ?? '', 'base64')

        expect(result.success).toBe(true)
        expect(result.mimeType).toBe('image/jpeg')
        expect(result.width).toBe(640)
        expect(result.height).toBe(320)
        expect(thumbnail.subarray(0, 2).toString('hex')).toBe('ffd8')
        expect(thumbnail.length).toBeLessThan(LARGE_IMAGE.length / 4)
    })

    it('rejects thumbnail dimensions outside the supported range', async () => {
        const result = await read('README.md', { thumbnail: true, maxDimension: 0 })

        expect(result).toEqual({ success: false, error: 'Invalid thumbnail max dimension' })
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
