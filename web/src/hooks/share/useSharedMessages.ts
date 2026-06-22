import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DecryptedMessage } from '@/types/api'
import type { ShareClient } from '@/api/shareClient'

function sortMessages(messages: DecryptedMessage[]): DecryptedMessage[] {
    return [...messages].sort((a, b) => {
        const seqA = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER
        const seqB = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER
        if (seqA !== seqB) return seqA - seqB
        return a.createdAt - b.createdAt
    })
}

function mergeMessages(current: DecryptedMessage[], incoming: DecryptedMessage[]): DecryptedMessage[] {
    const byId = new Map<string, DecryptedMessage>()
    for (const message of current) byId.set(message.id, message)
    for (const message of incoming) byId.set(message.id, message)
    return sortMessages(Array.from(byId.values()))
}

export function useSharedMessages(client: ShareClient, guestToken: string | null): {
    messages: DecryptedMessage[]
    setMessages: React.Dispatch<React.SetStateAction<DecryptedMessage[]>>
    isLoading: boolean
    error: string | null
    refetch: () => Promise<void>
} {
    const [messages, setMessages] = useState<DecryptedMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refetch = useCallback(async () => {
        if (!guestToken) return
        setIsLoading(true)
        setError(null)
        try {
            const response = await client.getMessages(guestToken, { limit: 200 })
            setMessages(sortMessages(response.messages))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load messages')
        } finally {
            setIsLoading(false)
        }
    }, [client, guestToken])

    useEffect(() => {
        setMessages([])
        void refetch()
    }, [refetch])

    return useMemo(() => ({
        messages,
        setMessages: (updater) => setMessages((prev) => {
            const next = typeof updater === 'function'
                ? (updater as (value: DecryptedMessage[]) => DecryptedMessage[])(prev)
                : updater
            return mergeMessages([], next)
        }),
        isLoading,
        error,
        refetch
    }), [messages, isLoading, error, refetch])
}
