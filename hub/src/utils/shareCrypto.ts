import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const TOKEN_BYTES = 32
const SCRYPT_KEY_BYTES = 32
const SCRYPT_SALT_BYTES = 16
const AES_IV_BYTES = 12

function base64url(buffer: Buffer): string {
    return buffer.toString('base64url')
}

function decodeBase64url(value: string): Buffer {
    return Buffer.from(value, 'base64url')
}

function constantTimeBufferEquals(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
        const maxLength = Math.max(a.length, b.length, 1)
        const paddedA = Buffer.alloc(maxLength)
        const paddedB = Buffer.alloc(maxLength)
        a.copy(paddedA)
        b.copy(paddedB)
        timingSafeEqual(paddedA, paddedB)
        return false
    }
    return timingSafeEqual(a, b)
}

function encryptionKey(secret: Uint8Array): Buffer {
    return createHash('sha256').update(secret).update('hapi-session-share-token-v1').digest()
}

export function generateShareToken(): string {
    return base64url(randomBytes(TOKEN_BYTES))
}

export function hashShareToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function hashSharePassword(password: string): string {
    const salt = randomBytes(SCRYPT_SALT_BYTES)
    const key = scryptSync(password, salt, SCRYPT_KEY_BYTES)
    return `scrypt:v1:${base64url(salt)}:${base64url(key)}`
}

export function verifySharePassword(password: string, hash: string): boolean {
    const parts = hash.split(':')
    if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
        return false
    }

    try {
        const salt = decodeBase64url(parts[2]!)
        const expected = decodeBase64url(parts[3]!)
        const actual = scryptSync(password, salt, expected.length)
        return constantTimeBufferEquals(actual, expected)
    } catch {
        return false
    }
}

export function encryptShareToken(token: string, secret: Uint8Array): string {
    const iv = randomBytes(AES_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `aes-256-gcm:v1:${base64url(iv)}:${base64url(ciphertext)}:${base64url(tag)}`
}

export function decryptShareToken(encrypted: string, secret: Uint8Array): string | null {
    const parts = encrypted.split(':')
    if (parts.length !== 5 || parts[0] !== 'aes-256-gcm' || parts[1] !== 'v1') {
        return null
    }

    try {
        const iv = decodeBase64url(parts[2]!)
        const ciphertext = decodeBase64url(parts[3]!)
        const tag = decodeBase64url(parts[4]!)
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
        return null
    }
}
