import { useEffect, useRef, useState } from 'react'
import type { DecryptedMessage } from '@/types/api'
import type { ShareClient, ShareSyncEvent } from '@/api/shareClient'

export function useShareSSE(options: {
    client: ShareClient
    guestToken: string | null
    onMessage: (message: DecryptedMessage) => void
    onInvalidate: () => void
    onSessionUpdate: () => void
}): { connected: boolean } {
    const [connected, setConnected] = useState(false)
    const onMessageRef = useRef(options.onMessage)
    const onInvalidateRef = useRef(options.onInvalidate)
    const onSessionUpdateRef = useRef(options.onSessionUpdate)

    useEffect(() => { onMessageRef.current = options.onMessage }, [options.onMessage])
    useEffect(() => { onInvalidateRef.current = options.onInvalidate }, [options.onInvalidate])
    useEffect(() => { onSessionUpdateRef.current = options.onSessionUpdate }, [options.onSessionUpdate])

    useEffect(() => {
        if (!options.guestToken) return
        const source = new EventSource(options.client.buildEventsUrl(options.guestToken))
        source.onopen = () => setConnected(true)
        source.onerror = () => setConnected(false)
        source.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as ShareSyncEvent
                if (data.type === 'connection-changed') {
                    setConnected(data.data?.status === 'connected')
                    return
                }
                if (data.type === 'message-received') {
                    onMessageRef.current(data.message)
                    return
                }
                if (data.type === 'messages-invalidated') {
                    onInvalidateRef.current()
                    return
                }
                if (data.type === 'session-updated') {
                    onSessionUpdateRef.current()
                }
            } catch {
                // Ignore malformed SSE event.
            }
        }
        return () => {
            setConnected(false)
            source.close()
        }
    }, [options.client, options.guestToken])

    return { connected }
}
