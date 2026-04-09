import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    CodexCollaborationMode,
    DecryptedMessage,
    PermissionMode,
    Session,
    SlashCommand
} from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { findUnsupportedCodexBuiltinSlashCommand } from '@/lib/codexSlashCommands'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { AutoContinueDialog } from '@/components/AutoContinueDialog'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'
import { allocateContinueRoundWithSource } from '@/lib/continueRounds'
import {
    AUTO_CONTINUE_DEFAULT_REMAINING,
    AUTO_CONTINUE_DEFAULT_KEYWORDS,
    AUTO_CONTINUE_DEFAULT_PROMPT,
    getLastAssistantLines,
    loadAutoContinueState,
    saveAutoContinueState,
    shouldAutoContinue
} from '@/lib/autoContinue'

export function SessionChat(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    messagesVersion: number
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string, attachments?: AttachmentMetadata[], options?: { localId?: string }) => string | null
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    availableSlashCommands?: readonly SlashCommand[]
}) {
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const sessionInactive = !props.session.active
    const terminalSupported = isRemoteTerminalSupported(props.session.metadata)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [autoContinueEnabled, setAutoContinueEnabled] = useState(false)
    const [autoContinueRemaining, setAutoContinueRemaining] = useState(AUTO_CONTINUE_DEFAULT_REMAINING)
    const [autoContinueMaxRuns, setAutoContinueMaxRuns] = useState(AUTO_CONTINUE_DEFAULT_REMAINING)
    const [autoContinueKeywords, setAutoContinueKeywords] = useState<string[]>(AUTO_CONTINUE_DEFAULT_KEYWORDS)
    const [autoContinuePrompt, setAutoContinuePrompt] = useState(AUTO_CONTINUE_DEFAULT_PROMPT)
    const [autoContinueDialogOpen, setAutoContinueDialogOpen] = useState(false)
    const agentFlavor = props.session.metadata?.flavor ?? null
    const controlledByUser = props.session.agentState?.controlledByUser === true
    const codexCollaborationModeSupported = agentFlavor === 'codex' && !controlledByUser
    const prevAutoContinueThinkingRef = useRef(props.session.thinking)
    const lastAutoContinueKeyRef = useRef<string | null>(null)
    const { abortSession, switchSession, setPermissionMode, setCollaborationMode, setModel, setEffort } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor,
        codexCollaborationModeSupported
    )

    // Voice assistant integration
    const voice = useVoiceOptional()

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => {
                props.onSend(message)
            },
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

    // Track and report new messages to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    // Report ready event when thinking stops
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    // Report permission requests to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
    }, [props.session.id])

    useEffect(() => {
        const state = loadAutoContinueState(props.session.id)
        setAutoContinueEnabled(state.enabled)
        setAutoContinueRemaining(state.remaining)
        setAutoContinueMaxRuns(state.maxRuns)
        setAutoContinueKeywords(state.keywords)
        setAutoContinuePrompt(state.prompt)
        lastAutoContinueKeyRef.current = null
    }, [props.session.id])

    useEffect(() => {
        prevAutoContinueThinkingRef.current = props.session.thinking
    }, [props.session.id])

    useEffect(() => {
        saveAutoContinueState(props.session.id, {
            enabled: autoContinueEnabled,
            remaining: autoContinueRemaining,
            maxRuns: autoContinueMaxRuns,
            keywords: autoContinueKeywords,
            prompt: autoContinuePrompt
        })
    }, [props.session.id, autoContinueEnabled, autoContinueRemaining, autoContinueMaxRuns, autoContinueKeywords, autoContinuePrompt])

    useEffect(() => {
        if (autoContinueEnabled && autoContinueRemaining <= 0) {
            setAutoContinueEnabled(false)
        }
    }, [autoContinueEnabled, autoContinueRemaining])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    const handleCollaborationModeChange = useCallback(async (mode: CodexCollaborationMode) => {
        try {
            await setCollaborationMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set collaboration mode:', e)
        }
    }, [setCollaborationMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelChange = useCallback(async (model: string | null) => {
        try {
            await setModel(model)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model:', e)
        }
    }, [setModel, props.onRefresh, haptic])

    const handleEffortChange = useCallback(async (effort: string | null) => {
        try {
            await setEffort(effort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set effort:', e)
        }
    }, [setEffort, props.onRefresh, haptic])

    // Abort handler
    const handleAbort = useCallback(async () => {
        await abortSession()
        props.onRefresh()
    }, [abortSession, props.onRefresh])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleSend = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        if (agentFlavor === 'codex') {
            const unsupportedCommand = findUnsupportedCodexBuiltinSlashCommand(
                text,
                props.availableSlashCommands ?? []
            )
            if (unsupportedCommand) {
                haptic.notification('error')
                addToast({
                    title: t('composer.codexSlashUnsupported.title'),
                    body: t('composer.codexSlashUnsupported.body', { command: `/${unsupportedCommand}` }),
                    sessionId: props.session.id,
                    url: `/sessions/${props.session.id}`
                })
                return null
            }
        }

        const localId = props.onSend(text, attachments)
        setForceScrollToken((token) => token + 1)
        return localId
    }, [agentFlavor, props.availableSlashCommands, props.onSend, props.session.id, addToast, haptic, t])

    const handleSendContinue = useCallback((source: 'manual' | 'auto' = 'manual') => {
        const localId = handleSend(autoContinuePrompt)
        if (localId) {
            allocateContinueRoundWithSource(props.session.id, localId, source)
        }
        return localId
    }, [autoContinuePrompt, handleSend, props.session.id])

    const handleAutoContinueToggle = useCallback(() => {
        setAutoContinueEnabled((current) => {
            if (current) {
                return false
            }

            setAutoContinueRemaining((remaining) => (
                remaining > 0 ? remaining : autoContinueMaxRuns
            ))
            return true
        })
    }, [autoContinueMaxRuns])

    const handleAutoContinueSettingsSave = useCallback((settings: {
        maxRuns: number
        remaining: number
        keywords: string[]
        prompt: string
    }) => {
        setAutoContinueMaxRuns(settings.maxRuns)
        setAutoContinueRemaining(settings.remaining)
        setAutoContinueKeywords(settings.keywords)
        setAutoContinuePrompt(settings.prompt)
    }, [])

    const handleSendCommit = useCallback(() => {
        handleSend('ok, commit it')
    }, [handleSend])

    const handleSendCommitAndPush = useCallback(() => {
        handleSend('ok, commit it and push')
    }, [handleSend])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter,
        allowSendWhenInactive: true
    })

    useEffect(() => {
        const completedTurn = prevAutoContinueThinkingRef.current && !props.session.thinking
        prevAutoContinueThinkingRef.current = props.session.thinking

        if (!completedTurn) return
        if (!autoContinueEnabled || autoContinueRemaining <= 0 || props.isSending) return

        const lastMessage = props.messages[props.messages.length - 1]
        const completionKey = `${lastMessage?.id ?? 'none'}:${props.messages.length}`
        if (lastAutoContinueKeyRef.current === completionKey) return

        const recentLines = getLastAssistantLines(reconciled.blocks)
        if (!shouldAutoContinue(recentLines, autoContinueKeywords)) return

        lastAutoContinueKeyRef.current = completionKey
        setAutoContinueRemaining((remaining) => Math.max(remaining - 1, 0))

        void (async () => {
            try {
                if (controlledByUser) {
                    await handleSwitchToRemote()
                }
                handleSendContinue('auto')
            } catch (error) {
                console.error('Auto continue failed:', error)
            }
        })()
    }, [
        props.session.thinking,
        props.messages,
        props.isSending,
        autoContinueEnabled,
        autoContinueRemaining,
        autoContinueKeywords,
        reconciled.blocks,
        controlledByUser,
        handleSendContinue,
        handleSwitchToRemote
    ])

    const displayedAutoContinueRemaining = autoContinueEnabled || autoContinueRemaining > 0
        ? autoContinueRemaining
        : autoContinueMaxRuns

    const autoContinueButton = (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={handleAutoContinueToggle}
                className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors ${
                    autoContinueEnabled
                        ? 'border-[var(--app-link)] bg-[var(--app-link)] text-[var(--app-bg)]'
                        : 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]'
                }`}
                title={t(autoContinueEnabled ? 'session.autoContinueOn' : 'session.autoContinueOff', {
                    n: displayedAutoContinueRemaining
                })}
            >
                <span>{t('session.autoContinueShort')}</span>
                <span>{displayedAutoContinueRemaining}</span>
            </button>
            <button
                type="button"
                onClick={() => setAutoContinueDialogOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
                title={t('session.autoContinueSettings')}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82L4.21 7.2a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.25V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
        </div>
    )

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SessionHeader
                session={props.session}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                api={props.api}
                onSessionDeleted={props.onBack}
                autoContinueButton={autoContinueButton}
            />

            {props.session.teamState && (
                <TeamPanel teamState={props.session.teamState} />
            )}

            {sessionInactive ? (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Sending will resume it automatically.
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={props.onAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                    />

                    <HappyComposer
                        sessionId={props.session.id}
                        disabled={props.isSending}
                        permissionMode={props.session.permissionMode}
                        collaborationMode={codexCollaborationModeSupported ? props.session.collaborationMode : undefined}
                        model={props.session.model}
                        effort={props.session.effort}
                        agentFlavor={agentFlavor}
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={props.session.thinking}
                        agentState={props.session.agentState}
                        contextSize={reduced.latestUsage?.contextSize}
                        controlledByUser={controlledByUser}
                        onCollaborationModeChange={
                            codexCollaborationModeSupported && props.session.active && !controlledByUser
                                ? handleCollaborationModeChange
                                : undefined
                        }
                        onPermissionModeChange={handlePermissionModeChange}
                        onModelChange={handleModelChange}
                        onEffortChange={handleEffortChange}
                        onSwitchToRemote={handleSwitchToRemote}
                        onSendContinue={handleSendContinue}
                        onSendCommit={handleSendCommit}
                        onSendCommitAndPush={handleSendCommitAndPush}
                        onTerminal={props.session.active && terminalSupported ? handleViewTerminal : undefined}
                        terminalUnsupported={props.session.active && !terminalSupported}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                    />
                </div>
            </AssistantRuntimeProvider>

            <AutoContinueDialog
                isOpen={autoContinueDialogOpen}
                onClose={() => setAutoContinueDialogOpen(false)}
                initialMaxRuns={autoContinueMaxRuns}
                initialRemaining={autoContinueRemaining}
                initialKeywords={autoContinueKeywords}
                initialPrompt={autoContinuePrompt}
                onSave={handleAutoContinueSettingsSave}
            />

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
