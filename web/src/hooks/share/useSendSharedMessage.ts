import { useState } from 'react'
import type { ShareClient } from '@/api/shareClient'

function randomLocalId(): string {
    return `share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function useSendSharedMessage(client: ShareClient, guestToken: string | null): {
    sendMessage: (text: string) => Promise<void>
    complete: () => Promise<void>
    isSending: boolean
    error: string | null
} {
    const [isSending, setIsSending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const sendMessage = async (text: string) => {
        if (!guestToken) return
        const trimmed = text.trim()
        if (!trimmed) return
        setIsSending(true)
        setError(null)
        try {
            await client.sendMessage(guestToken, trimmed, randomLocalId())
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send message')
            throw err
        } finally {
            setIsSending(false)
        }
    }

    const complete = async () => {
        if (!guestToken) return
        setIsSending(true)
        setError(null)
        try {
            await client.complete(guestToken)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to complete')
            throw err
        } finally {
            setIsSending(false)
        }
    }

    return { sendMessage, complete, isSending, error }
}
