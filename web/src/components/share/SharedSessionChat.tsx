import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { PublicShare, PublicSharedSession, ShareClient } from '@/api/shareClient'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { DecryptedMessage, Session, SessionMetadataSummary } from '@/types/api'
import { buildConversationOutline } from '@/chat/outline'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { isQueuedForInvocation } from '@/lib/messages'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { LoadingState } from '@/components/LoadingState'
import { useSharedMessages } from '@/hooks/share/useSharedMessages'
import { useSendSharedMessage } from '@/hooks/share/useSendSharedMessage'
import { useShareSSE } from '@/hooks/share/useShareSSE'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

function getSessionTitle(session: PublicSharedSession | null, share: PublicShare | null): string {
    return session?.metadata?.name?.trim()
        || session?.metadata?.summary?.text?.trim()
        || share?.label?.trim()
        || 'Shared session'
}

function buildRuntimeSession(session: PublicSharedSession | null, fallbackId: string): Session {
    const now = session?.updatedAt ?? Date.now()
    return {
        id: session?.id ?? fallbackId,
        namespace: 'share',
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: session?.active ?? false,
        activeAt: now,
        metadata: null,
        metadataVersion: 0,
        agentState: session?.agentState ?? null,
        agentStateVersion: 0,
        thinking: session?.thinking ?? false,
        thinkingAt: now,
        markerColor: null,
        pinned: false,
        model: null,
        modelReasoningEffort: null,
        serviceTier: null,
        effort: null
    }
}

function buildRuntimeMetadata(session: PublicSharedSession | null): SessionMetadataSummary | null {
    if (!session) return null
    return {
        path: '',
        host: '',
        name: session.metadata?.name,
        summary: session.metadata?.summary ? { text: session.metadata.summary.text, updatedAt: session.updatedAt } : undefined,
        flavor: session.metadata?.flavor ?? null
    }
}

export function SharedSessionChat(props: {
    client: ShareClient
    guestToken: string
    onUnauthorized: () => void
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const [session, setSession] = useState<PublicSharedSession | null>(null)
    const [share, setShare] = useState<PublicShare | null>(null)
    const [sessionError, setSessionError] = useState<string | null>(null)
    const [isLoadingSession, setIsLoadingSession] = useState(true)
    const [draft, setDraft] = useState('')
    const [completeDialogOpen, setCompleteDialogOpen] = useState(false)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const prevSessionIdRef = useRef<string | null>(null)

    const { messages, setMessages, isLoading, error, refetch } = useSharedMessages(props.client, props.guestToken)
    const { sendMessage, complete, isSending, error: sendError } = useSendSharedMessage(props.client, props.guestToken)

    const refreshSession = useCallback(async () => {
        setSessionError(null)
        try {
            const response = await props.client.getSession(props.guestToken)
            setSession(response.session)
            setShare(response.share)
        } catch (err) {
            if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 401) {
                props.onUnauthorized()
                return
            }
            setSessionError(err instanceof Error ? err.message : t('share.guest.loadFailed'))
        } finally {
            setIsLoadingSession(false)
        }
    }, [props, t])

    const refreshAll = useCallback(async () => {
        await Promise.all([refreshSession(), refetch()])
    }, [refreshSession, refetch])

    useEffect(() => {
        void refreshSession()
    }, [refreshSession])

    const shareApi = useMemo(() => ({
        approvePermission: (_sessionId: string, requestId: string, modeOrOptions?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | {
            mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
            allowTools?: string[]
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
            answers?: Record<string, string[]> | Record<string, { answers: string[] }>
        }) => props.client.approvePermission(props.guestToken, requestId, modeOrOptions),
        denyPermission: (_sessionId: string, requestId: string, options?: {
            decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
        }) => props.client.denyPermission(props.guestToken, requestId, options)
    }) as unknown as ApiClient, [props.client, props.guestToken])

    const { connected } = useShareSSE({
        client: props.client,
        guestToken: props.guestToken,
        onMessage: useCallback((message) => {
            setMessages((current) => [...current, message])
        }, [setMessages]),
        onInvalidate: useCallback(() => { void refetch() }, [refetch]),
        onSessionUpdate: useCallback(() => { void refreshAll() }, [refreshAll])
    })

    const visibleMessages = useMemo(
        () => messages.filter((message) => !isQueuedForInvocation(message)),
        [messages]
    )

    const normalizedMessages = useMemo(() => {
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== session?.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = session?.id ?? null

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()

        for (const message of visibleMessages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }

            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) {
                normalized.push(next)
            }
        }

        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }

        return normalized
    }, [session?.id, visibleMessages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, session?.agentState),
        [normalizedMessages, session?.agentState]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    const outlineItems = useMemo(
        () => buildConversationOutline(reconciled.blocks),
        [reconciled.blocks]
    )

    const runtimeSession = useMemo(
        () => buildRuntimeSession(session, props.guestToken),
        [session, props.guestToken]
    )
    const runtimeMetadata = useMemo(
        () => buildRuntimeMetadata(session),
        [session]
    )
    const runtime = useHappyRuntime({
        session: runtimeSession,
        blocks: reconciled.blocks,
        isSending,
        onSendMessage: async (text: string) => {
            await sendMessage(text)
        },
        onAbort: async () => {},
        allowSendWhenInactive: true
    })

    useEffect(() => {
        if (session?.active) {
            return
        }
        setCompleteDialogOpen(false)
    }, [session?.active])

    const handleSend = async (event: FormEvent) => {
        event.preventDefault()
        const text = draft.trim()
        if (!text || isSending) return
        setDraft('')
        try {
            await sendMessage(text)
            await refreshAll()
        } catch {
            setDraft(text)
        }
    }

    const handleCompleteConfirmed = useCallback(async () => {
        await complete()
        addToast({
            title: t('share.guest.complete'),
            body: t('share.guest.completed'),
            sessionId: session?.id ?? '',
            url: '',
            kind: 'message'
        })
        await refreshAll()
    }, [addToast, complete, refreshAll, session?.id, t])

    if (isLoadingSession) {
        return <div className="flex h-full items-center justify-center"><LoadingState label={t('loading.session')} /></div>
    }

    const title = getSessionTitle(session, share)
    const messagesVersion = (session?.updatedAt ?? 0) + messages.length
    const canSend = Boolean(session?.active) && !isSending

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                <header className="border-b border-[var(--app-border)] px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                    <div className="mx-auto flex w-full max-w-content items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-[var(--app-fg)]">
                                {title}
                            </div>
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('share.guest.subtitle')}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} title={connected ? 'connected' : 'disconnected'} />
                            <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={isSending || !session?.active}
                                onClick={() => setCompleteDialogOpen(true)}
                            >
                                {t('share.guest.complete')}
                            </Button>
                        </div>
                    </div>
                </header>

                {sessionError ? (
                    <div className="mx-auto w-full max-w-content px-4 py-3 text-sm text-red-600">{sessionError}</div>
                ) : null}
                {!connected ? (
                    <div className="mx-auto w-full max-w-content px-4 py-2 text-xs text-amber-600">
                        {t('share.guest.disconnected')}
                    </div>
                ) : null}

                <div className="flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        api={shareApi}
                        sessionId={session?.id ?? props.guestToken}
                        metadata={runtimeMetadata}
                        disabled={isSending || !session?.active}
                        onRefresh={() => { void refreshAll() }}
                        onFlushPending={() => {}}
                        onAtBottomChange={() => {}}
                        isLoadingMessages={isLoading}
                        messagesWarning={error}
                        hasMoreMessages={false}
                        isLoadingMoreMessages={false}
                        onLoadMore={async () => {}}
                        pendingCount={0}
                        rawMessagesCount={visibleMessages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={messagesVersion}
                        forceScrollToken={messagesVersion}
                        outlineOpen={false}
                        outlineTitle={title}
                        outlineItems={outlineItems}
                        onOutlineOpenChange={() => {}}
                    />
                </div>

                <form onSubmit={handleSend} className="border-t border-[var(--app-border)] bg-[var(--app-bg)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                    <div className="mx-auto flex w-full max-w-content gap-2">
                        <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    event.currentTarget.form?.requestSubmit()
                                }
                            }}
                            disabled={!canSend}
                            rows={2}
                            placeholder={session?.active ? t('share.guest.placeholder') : t('share.guest.inactive')}
                            className="min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] disabled:opacity-60"
                        />
                        <Button type="submit" disabled={!canSend || !draft.trim()}>
                            {t('share.guest.send')}
                        </Button>
                    </div>
                    {sendError ? (
                        <div className="mx-auto mt-2 w-full max-w-content text-sm text-red-600">{sendError}</div>
                    ) : null}
                </form>

                <ConfirmDialog
                    isOpen={completeDialogOpen}
                    onClose={() => setCompleteDialogOpen(false)}
                    title={t('share.guest.confirmComplete.title')}
                    description={t('share.guest.confirmComplete.description')}
                    confirmLabel={t('share.guest.confirmComplete.confirm')}
                    confirmingLabel={t('share.guest.confirmComplete.confirming')}
                    onConfirm={handleCompleteConfirmed}
                    isPending={isSending}
                />
            </div>
        </AssistantRuntimeProvider>
    )
}
