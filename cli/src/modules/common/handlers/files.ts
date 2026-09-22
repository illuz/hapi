import { logger } from '@/ui/logger'
import { readFile, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { resolveReadPath, validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

const DEFAULT_THUMBNAIL_MAX_DIMENSION = 640
const MIN_THUMBNAIL_MAX_DIMENSION = 64
const MAX_THUMBNAIL_MAX_DIMENSION = 2048
const THUMBNAIL_JPEG_QUALITY = 70

interface ReadFileRequest {
    path: string
    thumbnail?: boolean
    maxDimension?: number
}

interface ReadFileResponse {
    success: boolean
    content?: string
    mimeType?: string
    width?: number
    height?: number
    error?: string
}

interface WriteFileRequest {
    path: string
    content: string
    expectedHash?: string | null
}

interface WriteFileResponse {
    success: boolean
    hash?: string
    error?: string
}

async function createImageThumbnail(buffer: Buffer, maxDimension: number): Promise<{
    content: string
    mimeType: string
    width: number
    height: number
}> {
    const { Jimp, JimpMime } = await import('jimp')
    const image = await Jimp.read(buffer)
    const sourceWidth = image.bitmap.width
    const sourceHeight = image.bitmap.height
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))

    if (scale < 1) {
        image.resize({
            w: Math.max(1, Math.round(sourceWidth * scale)),
            h: Math.max(1, Math.round(sourceHeight * scale))
        })
    }

    const thumbnail = new Jimp({
        width: image.bitmap.width,
        height: image.bitmap.height,
        color: 0xffffffff
    })
    thumbnail.composite(image, 0, 0)

    const thumbnailBuffer = await thumbnail.getBuffer(JimpMime.jpeg, {
        quality: THUMBNAIL_JPEG_QUALITY
    })

    return {
        content: thumbnailBuffer.toString('base64'),
        mimeType: JimpMime.jpeg,
        width: thumbnail.bitmap.width,
        height: thumbnail.bitmap.height
    }
}

export function registerFileHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>('readFile', async (data) => {
        logger.debug('Read file request:', data.path)

        const resolution = await resolveReadPath(data.path, workingDirectory)
        if (!resolution.valid) {
            return rpcError(resolution.error)
        }

        const maxDimension = data.maxDimension ?? DEFAULT_THUMBNAIL_MAX_DIMENSION
        if (
            data.thumbnail
            && (
                !Number.isInteger(maxDimension)
                || maxDimension < MIN_THUMBNAIL_MAX_DIMENSION
                || maxDimension > MAX_THUMBNAIL_MAX_DIMENSION
            )
        ) {
            return rpcError('Invalid thumbnail max dimension')
        }

        try {
            const buffer = await readFile(resolution.path)

            if (data.thumbnail) {
                try {
                    return {
                        success: true,
                        ...await createImageThumbnail(buffer, maxDimension)
                    }
                } catch (error) {
                    logger.debug('Failed to create image thumbnail:', error)
                    return rpcError(getErrorMessage(error, 'Failed to create image thumbnail'))
                }
            }

            const content = buffer.toString('base64')
            return { success: true, content }
        } catch (error) {
            logger.debug('Failed to read file:', error)
            return rpcError(getErrorMessage(error, 'Failed to read file'))
        }
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(data.path)
                    const existingHash = createHash('sha256').update(existingBuffer).digest('hex')

                    if (existingHash !== data.expectedHash) {
                        return rpcError(`File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`)
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                    return rpcError('File does not exist but hash was provided')
                }
            } else {
                try {
                    await stat(data.path)
                    return rpcError('File already exists but was expected to be new')
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await writeFile(data.path, buffer)

            const hash = createHash('sha256').update(buffer).digest('hex')

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })
}
