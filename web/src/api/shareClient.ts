import type { AgentState, DecryptedMessage, MessagesResponse, PermissionMode, SyncEvent } from '@/types/api'

export type PublicShare = {
    id: string
    sessionId: string
    label: string | null
    expiresAt: number | null
    status: 'active' | 'expired' | 'revoked'
}

export type PublicSharedSession = {
    id: string
    active: boolean
    thinking: boolean
    updatedAt: number
    agentState: AgentState | null
    metadata: {
        name?: string
        summary?: { text: string }
        flavor?: string | null
    } | null
}

export type ShareAuthResponse = {
    token: string
    share: PublicShare
}

export type SharedSessionResponse = {
    share: PublicShare
    session: PublicSharedSession
}

type SharePermissionAnswerPayload = {
    mode?: PermissionMode
    allowTools?: string[]
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    answers?: Record<string, string[]> | Record<string, { answers: string[] }>
}

export class ShareApiError extends Error {
    status: number
    body?: string

    constructor(message: string, status: number, body?: string) {
        super(message)
        this.name = 'ShareApiError'
        this.status = status
        this.body = body
    }
}

function buildUrl(path: string, baseUrl?: string): string {
    if (!baseUrl) return path
    try {
        return new URL(path, baseUrl).toString()
    } catch {
        return path
    }
}

export class ShareClient {
    constructor(
        private readonly token: string,
        private readonly baseUrl?: string
    ) {
    }

    private path(suffix: string): string {
        return `/api/share/${encodeURIComponent(this.token)}${suffix}`
    }

    private async request<T>(suffix: string, init?: RequestInit, guestToken?: string | null): Promise<T> {
        const headers = new Headers(init?.headers)
        if (guestToken) {
            headers.set('authorization', `Bearer ${guestToken}`)
        }
        if (init?.body !== undefined && !headers.has('content-type')) {
            headers.set('content-type', 'application/json')
        }
        const res = await fetch(buildUrl(this.path(suffix), this.baseUrl), { ...init, headers })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new ShareApiError(`HTTP ${res.status} ${res.statusText}`, res.status, body || undefined)
        }
        return await res.json() as T
    }

    async authenticate(password: string): Promise<ShareAuthResponse> {
        return await this.request<ShareAuthResponse>('/auth', {
            method: 'POST',
            body: JSON.stringify({ password })
        })
    }

    async getSession(guestToken: string): Promise<SharedSessionResponse> {
        return await this.request<SharedSessionResponse>('/session', undefined, guestToken)
    }

    async getMessages(guestToken: string, options: { beforeSeq?: number | null; limit?: number } = {}): Promise<MessagesResponse> {
        const params = new URLSearchParams()
        if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
            params.set('beforeSeq', `${options.beforeSeq}`)
        }
        if (options.limit !== undefined) {
            params.set('limit', `${options.limit}`)
        }
        const qs = params.toString()
        return await this.request<MessagesResponse>(`/messages${qs ? `?${qs}` : ''}`, undefined, guestToken)
    }

    async sendMessage(guestToken: string, text: string, localId?: string): Promise<void> {
        await this.request('/messages', {
            method: 'POST',
            body: JSON.stringify({ text, localId })
        }, guestToken)
    }

    async approvePermission(
        guestToken: string,
        requestId: string,
        modeOrOptions?: PermissionMode | SharePermissionAnswerPayload
    ): Promise<void> {
        const body = typeof modeOrOptions === 'string' || modeOrOptions === undefined
            ? { mode: modeOrOptions }
            : modeOrOptions
        await this.request(`/permissions/${encodeURIComponent(requestId)}/approve`, {
            method: 'POST',
            body: JSON.stringify(body)
        }, guestToken)
    }

    async denyPermission(
        guestToken: string,
        requestId: string,
        options?: { decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort' }
    ): Promise<void> {
        await this.request(`/permissions/${encodeURIComponent(requestId)}/deny`, {
            method: 'POST',
            body: JSON.stringify(options ?? {})
        }, guestToken)
    }

    async complete(guestToken: string): Promise<void> {
        await this.request('/complete', { method: 'POST', body: JSON.stringify({}) }, guestToken)
    }

    buildEventsUrl(guestToken: string): string {
        const params = new URLSearchParams()
        params.set('guestToken', guestToken)
        return buildUrl(this.path(`/events?${params.toString()}`), this.baseUrl)
    }
}

export type ShareSyncEvent = SyncEvent | { type: 'connection-changed'; data?: { status?: string } }
export type SharedMessage = DecryptedMessage
