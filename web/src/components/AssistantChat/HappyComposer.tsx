import { getCodexCollaborationModeOptions, getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import { ComposerPrimitive, useAssistantApi, useAssistantState } from '@assistant-ui/react'
import {
    type ChangeEvent as ReactChangeEvent,
    type ClipboardEvent as ReactClipboardEvent,
    type FormEvent as ReactFormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { AgentState, CodexCollaborationMode, PermissionMode } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import type { ConversationStatus } from '@/realtime/types'
import { useActiveWord } from '@/hooks/useActiveWord'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { applySuggestion } from '@/utils/applySuggestion'
import { usePlatform } from '@/hooks/usePlatform'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { supportsEffort, supportsModelChange } from '@hapi/protocol'
import { markSkillUsed } from '@/lib/recent-skills'
import { clearComposerDraft, getComposerDraft, saveComposerDraft } from '@/lib/composerDraftStorage'
import { useComposerDraft } from '@/hooks/useComposerDraft'
import { useComposerEnterBehavior } from '@/hooks/useComposerEnterBehavior'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { StatusBar } from '@/components/AssistantChat/StatusBar'
import { ComposerButtons } from '@/components/AssistantChat/ComposerButtons'
import { AttachmentItem } from '@/components/AssistantChat/AttachmentItem'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'
import {
    getCollapsedComposerMaxRowsFromDelta,
    getInitialCollapsedComposerMaxRows,
    measureComposerVisualLines,
    COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY,
    saveCollapsedComposerMaxRows,
    safeRemoveItem,
    shouldShowCollapsedComposerResize,
    shouldShowExpandedComposerTrigger
} from './composerExpand'
import { getModelOptionsForFlavor, getNextModelForFlavor } from './modelOptions'
import { getClaudeComposerEffortOptions } from './claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from './codexReasoningEffortOptions'

export interface TextInputState {
    text: string
    selection: { start: number; end: number }
}

export type QuickPromptAction = {
    id: string
    label: string
    message: string
}

const defaultSuggestionHandler = async (): Promise<Suggestion[]> => []

const expandedComposerHeightClass = 'h-[calc(var(--tg-viewport-stable-height,var(--app-viewport-height,100dvh))-16px)] max-h-[calc(var(--tg-viewport-stable-height,var(--app-viewport-height,100dvh))-16px)]'
const collapsedComposerMinRows = 2
const mobileCollapsedComposerMaxRows = 3

function ExpandIcon() {
    return (
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
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="m21 3-7 7" />
            <path d="m3 21 7-7" />
        </svg>
    )
}

function ResizeHandleIcon() {
    return (
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
            <path d="M7 15h10" />
            <path d="M7 10h10" />
        </svg>
    )
}

function CloseIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m18 6-12 12" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

export function HappyComposer(props: {
    sessionId?: string
    disabled?: boolean
    permissionMode?: PermissionMode
    collaborationMode?: CodexCollaborationMode
    model?: string | null
    modelReasoningEffort?: string | null
    serviceTier?: string | null
    effort?: string | null
    active?: boolean
    allowSendWhenInactive?: boolean
    thinking?: boolean
    agentState?: AgentState | null
    backgroundTaskCount?: number
    contextSize?: number
    contextCacheRead?: number
    contextWindow?: number | null
    controlledByUser?: boolean
    agentFlavor?: string | null
    availableModelOptions?: Array<{ value: string | null; label: string }>
    onCollaborationModeChange?: (mode: CodexCollaborationMode) => void
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string | null) => void
    onModelReasoningEffortChange?: (modelReasoningEffort: string | null) => void
    onEffortChange?: (effort: string | null) => void
    onSwitchToRemote?: () => void
    onSendContinue?: () => void
    quickPromptActions?: QuickPromptAction[]
    onSendQuickPrompt?: (action: QuickPromptAction) => void
    onTerminal?: () => void
    terminalUnsupported?: boolean
    autocompletePrefixes?: string[]
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    // Voice assistant props
    voiceStatus?: ConversationStatus
    voiceMicMuted?: boolean
    onVoiceToggle?: () => void
    onVoiceMicToggle?: () => void
}) {
    const { t } = useTranslation()
    const {
        sessionId,
        disabled = false,
        permissionMode: rawPermissionMode,
        collaborationMode: rawCollaborationMode,
        model: rawModel,
        modelReasoningEffort: rawModelReasoningEffort,
        serviceTier,
        effort: rawEffort,
        active = true,
        allowSendWhenInactive = false,
        thinking = false,
        agentState,
        backgroundTaskCount,
        contextSize,
        contextCacheRead,
        contextWindow,
        controlledByUser = false,
        agentFlavor,
        availableModelOptions,
        onCollaborationModeChange,
        onPermissionModeChange,
        onModelChange,
        onModelReasoningEffortChange,
        onEffortChange,
        onSwitchToRemote,
        onSendContinue,
        quickPromptActions = [],
        onSendQuickPrompt,
        onTerminal,
        terminalUnsupported = false,
        autocompletePrefixes = ['@', '/', '$'],
        autocompleteSuggestions = defaultSuggestionHandler,
        voiceStatus = 'disconnected',
        voiceMicMuted = false,
        onVoiceToggle,
        onVoiceMicToggle
    } = props

    // Use ?? so missing values fall back to default (destructuring defaults only handle undefined)
    const permissionMode = rawPermissionMode ?? 'default'
    const collaborationMode = rawCollaborationMode ?? 'default'
    const model = rawModel ?? null
    const modelReasoningEffort = rawModelReasoningEffort ?? null
    const effort = rawEffort ?? null

    const api = useAssistantApi()
    const { composerEnterBehavior } = useComposerEnterBehavior()
    const composerText = useAssistantState(({ composer }) => composer.text)
    const attachments = useAssistantState(({ composer }) => composer.attachments)
    const threadIsRunning = useAssistantState(({ thread }) => thread.isRunning)
    const threadIsDisabled = useAssistantState(({ thread }) => thread.isDisabled)

    const controlsDisabled = disabled || (!active && !allowSendWhenInactive) || threadIsDisabled
    const trimmed = composerText.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0
    const attachmentsReady = !hasAttachments || attachments.every((attachment) => {
        if (attachment.status.type === 'complete') {
            return true
        }
        if (attachment.status.type !== 'requires-action') {
            return false
        }
        const path = (attachment as { path?: string }).path
        return typeof path === 'string' && path.length > 0
    })
    const canSend = (hasText || hasAttachments) && attachmentsReady && !controlsDisabled

    const [inputState, setInputState] = useState<TextInputState>({
        text: '',
        selection: { start: 0, end: 0 }
    })
    const [showSettings, setShowSettings] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [isSwitching, setIsSwitching] = useState(false)
    const [isContinuing, setIsContinuing] = useState(false)
    const [showContinueHint, setShowContinueHint] = useState(false)
    const [showQuickPrompts, setShowQuickPrompts] = useState(false)
    const [showExpandedComposer, setShowExpandedComposer] = useState(false)
    const [collapsedVisualLineCount, setCollapsedVisualLineCount] = useState(1)
    const [collapsedComposerMaxRows, setCollapsedComposerMaxRows] = useState(getInitialCollapsedComposerMaxRows)
    const [isResizingCollapsedComposer, setIsResizingCollapsedComposer] = useState(false)

    const collapsedTextareaRef = useRef<HTMLTextAreaElement>(null)
    const expandedTextareaRef = useRef<HTMLTextAreaElement>(null)
    const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null)
    const prevControlledByUser = useRef(controlledByUser)
    const prevExpandedComposerRef = useRef(false)
    const loadedDraftKeyRef = useRef<string | null>(null)
    const collapsedResizeStartRowsRef = useRef(collapsedComposerMaxRows)
    const collapsedResizePointerIdRef = useRef<number | null>(null)
    const collapsedResizeStartYRef = useRef(0)
    const draftSessionId = sessionId ?? null

    useComposerDraft(sessionId, composerText, (text) => api.composer().setText(text))

    useEffect(() => {
        setInputState((prev) => {
            if (prev.text === composerText) return prev
            // When syncing from composerText, update selection to end of text
            // This ensures activeWord detection works correctly
            const newPos = composerText.length
            return { text: composerText, selection: { start: newPos, end: newPos } }
        })
    }, [composerText])

    // Track one-time "continue" hint after switching from local to remote.
    useEffect(() => {
        if (prevControlledByUser.current === true && controlledByUser === false) {
            setShowContinueHint(true)
        }
        if (controlledByUser) {
            setShowContinueHint(false)
        }
        prevControlledByUser.current = controlledByUser
    }, [controlledByUser])

    const { haptic: platformHaptic, isTouch } = usePlatform()
    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    const bottomPaddingClass = isIOSPWA ? 'pb-0' : 'pb-3'
    const activeWord = useActiveWord(inputState.text, inputState.selection, autocompletePrefixes)
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeWord,
        autocompleteSuggestions,
        { clampSelection: true, wrapAround: true }
    )

    const haptic = useCallback((type: 'light' | 'success' | 'error' = 'light') => {
        if (type === 'light') {
            platformHaptic.impact('light')
        } else if (type === 'success') {
            platformHaptic.notification('success')
        } else {
            platformHaptic.notification('error')
        }
    }, [platformHaptic])

    const setCollapsedInputRef = useCallback((node: HTMLTextAreaElement | null) => {
        collapsedTextareaRef.current = node
        if (!showExpandedComposer) {
            activeTextareaRef.current = node
        }
    }, [showExpandedComposer])

    const updateCollapsedVisualLineCount = useCallback(() => {
        if (typeof window === 'undefined') return

        const textarea = collapsedTextareaRef.current
        if (!textarea) {
            setCollapsedVisualLineCount(1)
            return
        }

        const styles = window.getComputedStyle(textarea)
        setCollapsedVisualLineCount(measureComposerVisualLines({
            scrollHeight: textarea.scrollHeight,
            lineHeight: Number.parseFloat(styles.lineHeight),
            paddingTop: Number.parseFloat(styles.paddingTop),
            paddingBottom: Number.parseFloat(styles.paddingBottom)
        }))
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        const activeTextarea = activeTextareaRef.current ?? collapsedTextareaRef.current
        if (!suggestion || !activeTextarea) return
        if (suggestion.text.startsWith('$')) {
            markSkillUsed(suggestion.text.slice(1))
        }

        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            autocompletePrefixes,
            true
        )

        api.composer().setText(result.text)
        setInputState({
            text: result.text,
            selection: { start: result.cursorPosition, end: result.cursorPosition }
        })

        setTimeout(() => {
            const el = activeTextareaRef.current ?? activeTextarea
            if (!el) return
            el.setSelectionRange(result.cursorPosition, result.cursorPosition)
            try {
                el.focus({ preventScroll: true })
            } catch {
                el.focus()
            }
        }, 0)

        haptic('light')
    }, [api, suggestions, inputState, autocompletePrefixes, haptic])

    const abortDisabled = controlsDisabled || isAborting || !threadIsRunning
    const showSwitchButton = Boolean(controlledByUser && onSwitchToRemote)
    const switchDisabled = controlsDisabled || isSwitching || isContinuing || !controlledByUser
    const showContinueButton = Boolean(onSendContinue)
    const showQuickPromptButton = quickPromptActions.length > 0 && Boolean(onSendQuickPrompt)
    const continueDisabled = controlsDisabled || threadIsRunning || isSwitching || isContinuing
    const showTerminalButton = Boolean(onTerminal || terminalUnsupported)
    const terminalDisabled = controlsDisabled || terminalUnsupported
    const terminalLabel = terminalUnsupported ? t('terminal.unsupportedWindows') : t('composer.terminal')
    const showExpandedComposerTrigger = shouldShowExpandedComposerTrigger(composerText, collapsedVisualLineCount)
    const effectiveCollapsedComposerMaxRows = isTouch ? mobileCollapsedComposerMaxRows : collapsedComposerMaxRows
    const showCollapsedResizeControls = !isTouch && shouldShowCollapsedComposerResize(
        composerText,
        collapsedVisualLineCount,
        effectiveCollapsedComposerMaxRows
    )

    useEffect(() => {
        if (!isAborting) return
        if (threadIsRunning) return
        setIsAborting(false)
    }, [isAborting, threadIsRunning])

    useEffect(() => {
        if (!isSwitching) return
        if (controlledByUser) return
        setIsSwitching(false)
    }, [isSwitching, controlledByUser])

    useEffect(() => {
        if (!isContinuing) return
        if (controlledByUser) return
        setIsContinuing(false)
    }, [isContinuing, controlledByUser])

    useEffect(() => {
        if (!draftSessionId) {
            loadedDraftKeyRef.current = null
            return
        }

        const savedDraft = getComposerDraft(draftSessionId)

        loadedDraftKeyRef.current = draftSessionId
        api.composer().setText(savedDraft)
        setInputState({
            text: savedDraft,
            selection: { start: savedDraft.length, end: savedDraft.length }
        })
    }, [api, draftSessionId])

    useEffect(() => {
        if (!draftSessionId) return
        if (loadedDraftKeyRef.current !== draftSessionId) return

        saveComposerDraft(draftSessionId, composerText)
    }, [composerText, draftSessionId])

    useEffect(() => {
        updateCollapsedVisualLineCount()
    }, [composerText, attachments.length, collapsedComposerMaxRows, updateCollapsedVisualLineCount])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const handleResize = () => updateCollapsedVisualLineCount()
        window.addEventListener('resize', handleResize)

        return () => window.removeEventListener('resize', handleResize)
    }, [updateCollapsedVisualLineCount])

    useEffect(() => {
        const textarea = collapsedTextareaRef.current
        if (!textarea || typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(() => updateCollapsedVisualLineCount())
        observer.observe(textarea)

        return () => observer.disconnect()
    }, [updateCollapsedVisualLineCount, composerText, collapsedComposerMaxRows])

    useEffect(() => {
        const wasExpanded = prevExpandedComposerRef.current
        prevExpandedComposerRef.current = showExpandedComposer

        if (typeof window === 'undefined') return

        if (showExpandedComposer) {
            const timer = window.setTimeout(() => {
                const textarea = expandedTextareaRef.current
                if (!textarea) return
                activeTextareaRef.current = textarea
                const start = Math.min(inputState.selection.start, textarea.value.length)
                const end = Math.min(inputState.selection.end, textarea.value.length)
                try {
                    textarea.focus({ preventScroll: true })
                } catch {
                    textarea.focus()
                }
                textarea.setSelectionRange(start, end)
            }, 0)

            return () => window.clearTimeout(timer)
        }

        if (!wasExpanded) return

        const timer = window.setTimeout(() => {
            const textarea = collapsedTextareaRef.current
            if (!textarea) return
            activeTextareaRef.current = textarea
            const start = Math.min(inputState.selection.start, textarea.value.length)
            const end = Math.min(inputState.selection.end, textarea.value.length)
            try {
                textarea.focus({ preventScroll: true })
            } catch {
                textarea.focus()
            }
            textarea.setSelectionRange(start, end)
        }, 0)

        return () => window.clearTimeout(timer)
    }, [showExpandedComposer, inputState.selection.end, inputState.selection.start])

    const clearDraft = useCallback(() => {
        if (!draftSessionId) return
        clearComposerDraft(draftSessionId)
    }, [draftSessionId])

    useEffect(() => {
        if (isTouch) {
            safeRemoveItem(COLLAPSED_COMPOSER_MAX_ROWS_STORAGE_KEY)
            return
        }

        saveCollapsedComposerMaxRows(collapsedComposerMaxRows)
    }, [collapsedComposerMaxRows, isTouch])

    useEffect(() => {
        if (!isResizingCollapsedComposer) return

        const onMove = (event: PointerEvent) => {
            if (event.pointerId !== collapsedResizePointerIdRef.current) return

            setCollapsedComposerMaxRows(getCollapsedComposerMaxRowsFromDelta({
                startRows: collapsedResizeStartRowsRef.current,
                deltaY: event.clientY - collapsedResizeStartYRef.current
            }))
        }

        const onUp = (event: PointerEvent) => {
            if (event.pointerId !== collapsedResizePointerIdRef.current) return
            collapsedResizePointerIdRef.current = null
            setIsResizingCollapsedComposer(false)
        }

        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)

        return () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', onUp)
        }
    }, [isResizingCollapsedComposer])

    useEffect(() => {
        if (!isResizingCollapsedComposer) {
            document.body.style.removeProperty('user-select')
            document.body.style.removeProperty('cursor')
            return
        }

        document.body.style.setProperty('user-select', 'none')
        document.body.style.setProperty('cursor', 'ns-resize')

        return () => {
            document.body.style.removeProperty('user-select')
            document.body.style.removeProperty('cursor')
        }
    }, [isResizingCollapsedComposer])

    const sendComposer = useCallback(() => {
        api.composer().send()
        clearDraft()
        setShowContinueHint(false)
        setShowQuickPrompts(false)
        clearSuggestions()
        setShowExpandedComposer(false)
    }, [api, clearDraft, clearSuggestions])

    const handleAbort = useCallback(() => {
        if (abortDisabled) return
        haptic('error')
        setIsAborting(true)
        api.thread().cancelRun()
    }, [abortDisabled, api, haptic])

    const handleSwitch = useCallback(async () => {
        if (switchDisabled || !onSwitchToRemote) return
        haptic('light')
        setIsSwitching(true)
        try {
            await onSwitchToRemote()
        } catch {
            setIsSwitching(false)
        }
    }, [switchDisabled, onSwitchToRemote, haptic])

    const handleContinue = useCallback(async () => {
        if (continueDisabled || !onSendContinue) return
        haptic('light')
        setIsContinuing(true)
        setShowQuickPrompts(false)
        try {
            if (controlledByUser && onSwitchToRemote) {
                await onSwitchToRemote()
            }
            onSendContinue()
            setShowContinueHint(false)
        } catch {
            setIsContinuing(false)
        }
    }, [continueDisabled, onSendContinue, haptic, controlledByUser, onSwitchToRemote])

    const handleQuickPrompt = useCallback(async (action: QuickPromptAction) => {
        if (continueDisabled || !onSendQuickPrompt) return
        haptic('light')
        onSendQuickPrompt(action)
        setShowContinueHint(false)
        setShowQuickPrompts(false)
    }, [continueDisabled, onSendQuickPrompt, haptic])

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const collaborationModeOptions = useMemo(
        () => agentFlavor === 'codex' ? getCodexCollaborationModeOptions() : [],
        [agentFlavor]
    )
    const modelOptions = useMemo(
        () => getModelOptionsForFlavor(agentFlavor, model, availableModelOptions),
        [agentFlavor, model, availableModelOptions]
    )
    const codexReasoningEffortOptions = useMemo(
        () => agentFlavor === 'codex' ? getCodexComposerReasoningEffortOptions(modelReasoningEffort, model) : [],
        [agentFlavor, modelReasoningEffort, model]
    )
    const claudeEffortOptions = useMemo(
        () => getClaudeComposerEffortOptions(effort),
        [effort]
    )
    const permissionModes = useMemo(
        () => permissionModeOptions.map((option) => option.mode),
        [permissionModeOptions]
    )

    const handleExpandedComposerOpenChange = useCallback((open: boolean) => {
        if (showExpandedComposer === open) return

        setShowSettings(false)
        setShowQuickPrompts(false)
        clearSuggestions()
        setShowExpandedComposer(open)

        if (open) {
            haptic('light')
        }
    }, [showExpandedComposer, clearSuggestions, haptic])

    const handleCollapsedResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()

        collapsedResizePointerIdRef.current = event.pointerId
        collapsedResizeStartYRef.current = event.clientY
        collapsedResizeStartRowsRef.current = collapsedComposerMaxRows
        try {
            event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
        }
        setIsResizingCollapsedComposer(true)
        haptic('light')
    }, [collapsedComposerMaxRows, haptic])

    const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        const key = e.key

        // Avoid intercepting IME composition keystrokes (Enter, arrows, etc.)
        if (e.nativeEvent.isComposing) {
            return
        }

        // Shift+Enter inserts a newline (standard behavior)
        if (key === 'Enter' && e.shiftKey) {
            return // let default textarea behavior handle newline
        }

        // In newline mode, Cmd/Ctrl+Enter should send even if autocomplete is open.
        if (
            key === 'Enter'
            && composerEnterBehavior === 'newline'
            && (e.ctrlKey || e.metaKey)
            && !e.altKey
        ) {
            e.preventDefault()
            if (canSend) {
                sendComposer()
            }
            return
        }

        // Enter with suggestions visible: select the suggestion
        if (key === 'Enter' && suggestions.length > 0) {
            e.preventDefault()
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
            handleSuggestionSelect(indexToSelect)
            return
        }

        // Only plain Enter sends in send mode; modifier combos are ignored here.
        if (key === 'Enter') {
            if (composerEnterBehavior === 'newline') {
                return
            }
            e.preventDefault()
            if (!e.ctrlKey && !e.altKey && !e.metaKey && canSend) {
                sendComposer()
            }
            return
        }

        if (suggestions.length > 0) {
            if (key === 'ArrowUp') {
                e.preventDefault()
                moveUp()
                return
            }
            if (key === 'ArrowDown') {
                e.preventDefault()
                moveDown()
                return
            }
            if ((key === 'Tab') && !e.shiftKey) {
                e.preventDefault()
                const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
                handleSuggestionSelect(indexToSelect)
                return
            }
            if (key === 'Escape') {
                e.preventDefault()
                clearSuggestions()
                return
            }
        }

        if (key === 'Escape' && threadIsRunning) {
            e.preventDefault()
            handleAbort()
            return
        }

        if (key === 'Tab' && e.shiftKey && onPermissionModeChange && permissionModes.length > 0) {
            e.preventDefault()
            const currentIndex = permissionModes.indexOf(permissionMode)
            const nextIndex = (currentIndex + 1) % permissionModes.length
            const nextMode = permissionModes[nextIndex] ?? 'default'
            onPermissionModeChange(nextMode)
            haptic('light')
        }
    }, [
        suggestions,
        selectedIndex,
        moveUp,
        moveDown,
        clearSuggestions,
        handleSuggestionSelect,
        threadIsRunning,
        handleAbort,
        onPermissionModeChange,
        permissionMode,
        permissionModes,
        canSend,
        haptic,
        composerEnterBehavior,
        sendComposer
    ])

    useEffect(() => {
        const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'm' && (e.metaKey || e.ctrlKey) && onModelChange && supportsModelChange(agentFlavor)) {
                e.preventDefault()
                onModelChange(getNextModelForFlavor(agentFlavor, model, availableModelOptions))
                haptic('light')
            }
        }

        window.addEventListener('keydown', handleGlobalKeyDown)
        return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [model, onModelChange, haptic, agentFlavor, availableModelOptions])

    const handleChange = useCallback((e: ReactChangeEvent<HTMLTextAreaElement>) => {
        const selection = {
            start: e.target.selectionStart,
            end: e.target.selectionEnd
        }
        setInputState({ text: e.target.value, selection })
    }, [])

    const handleExpandedChange = useCallback((e: ReactChangeEvent<HTMLTextAreaElement>) => {
        const nextText = e.target.value
        const selection = {
            start: e.target.selectionStart,
            end: e.target.selectionEnd
        }

        api.composer().setText(nextText)
        setInputState({ text: nextText, selection })
    }, [api])

    const handleSelect = useCallback((e: ReactSyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement
        setInputState(prev => ({
            ...prev,
            selection: { start: target.selectionStart, end: target.selectionEnd }
        }))
    }, [])

    const handlePaste = useCallback(async (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData?.files || [])
        const imageFiles = files.filter(file => file.type.startsWith('image/'))

        if (imageFiles.length === 0) return

        e.preventDefault()

        try {
            for (const file of imageFiles) {
                await api.composer().addAttachment(file)
            }
        } catch (error) {
            console.error('Error adding pasted image:', error)
        }
    }, [api])

    const handleSettingsToggle = useCallback(() => {
        haptic('light')
        setShowSettings(prev => !prev)
        setShowQuickPrompts(false)
    }, [haptic])

    const handleQuickPromptToggle = useCallback(() => {
        if (!showQuickPromptButton || continueDisabled) return
        haptic('light')
        setShowSettings(false)
        setShowQuickPrompts(prev => !prev)
    }, [showQuickPromptButton, continueDisabled, haptic])

    const handleSubmit = useCallback((event?: ReactFormEvent<HTMLFormElement>) => {
        if (event && !attachmentsReady) {
            event.preventDefault()
            return
        }
        setShowContinueHint(false)
        setShowQuickPrompts(false)
    }, [attachmentsReady])

    const handlePermissionChange = useCallback((mode: PermissionMode) => {
        if (!onPermissionModeChange || controlsDisabled) return
        onPermissionModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onPermissionModeChange, controlsDisabled, haptic])

    const handleCollaborationChange = useCallback((mode: CodexCollaborationMode) => {
        if (!onCollaborationModeChange || controlsDisabled) return
        onCollaborationModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onCollaborationModeChange, controlsDisabled, haptic])

    const handleModelChange = useCallback((nextModel: string | null) => {
        if (!onModelChange || controlsDisabled) return
        onModelChange(nextModel)
        setShowSettings(false)
        haptic('light')
    }, [onModelChange, controlsDisabled, haptic])

    const handleModelReasoningEffortChange = useCallback((nextModelReasoningEffort: string | null) => {
        if (!onModelReasoningEffortChange || controlsDisabled) return
        onModelReasoningEffortChange(nextModelReasoningEffort)
        setShowSettings(false)
        haptic('light')
    }, [onModelReasoningEffortChange, controlsDisabled, haptic])

    const handleEffortChange = useCallback((nextEffort: string | null) => {
        if (!onEffortChange || controlsDisabled) return
        onEffortChange(nextEffort)
        setShowSettings(false)
        haptic('light')
    }, [onEffortChange, controlsDisabled, haptic])

    const showCollaborationSettings = Boolean(onCollaborationModeChange && collaborationModeOptions.length > 0)
    const showPermissionSettings = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)
    const showModelSettings = Boolean(onModelChange && supportsModelChange(agentFlavor) && modelOptions.length > 0)
    const showModelReasoningEffortSettings = Boolean(onModelReasoningEffortChange && codexReasoningEffortOptions.length > 0)
    const showEffortSettings = Boolean(onEffortChange && supportsEffort(agentFlavor))
    const showSettingsButton = Boolean(
        showCollaborationSettings
        || showPermissionSettings
        || showModelSettings
        || showModelReasoningEffortSettings
        || showEffortSettings
    )
    const showAbortButton = true
    const voiceEnabled = Boolean(onVoiceToggle)

    const handleSend = useCallback(() => {
        sendComposer()
    }, [sendComposer])

    const overlays = useMemo(() => {
        if (showExpandedComposer) {
            return null
        }

        if (showSettings && (showCollaborationSettings || showPermissionSettings || showModelSettings || showModelReasoningEffortSettings || showEffortSettings)) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
                        {showCollaborationSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.collaborationMode')}
                                </div>
                                {collaborationModeOptions.map((option) => (
                                    <button
                                        key={option.mode}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleCollaborationChange(option.mode)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                collaborationMode === option.mode
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {collaborationMode === option.mode && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={collaborationMode === option.mode ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showCollaborationSettings && (showPermissionSettings || showModelSettings || showModelReasoningEffortSettings || showEffortSettings) ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showPermissionSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.permissionMode')}
                                </div>
                                {permissionModeOptions.map((option) => (
                                    <button
                                        key={option.mode}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handlePermissionChange(option.mode)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                permissionMode === option.mode
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {permissionMode === option.mode && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={permissionMode === option.mode ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {(showCollaborationSettings || showPermissionSettings) && (showModelSettings || showModelReasoningEffortSettings || showEffortSettings) ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showModelSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.model')}
                                </div>
                                {modelOptions.map((option) => (
                                    <button
                                        key={option.value ?? 'auto'}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleModelChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                model === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {model === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={model === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {(showModelSettings || showModelReasoningEffortSettings) && showEffortSettings ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showModelReasoningEffortSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.reasoningEffort')}
                                </div>
                                {codexReasoningEffortOptions.map((option) => (
                                    <button
                                        key={option.value ?? 'default'}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleModelReasoningEffortChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                modelReasoningEffort === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {modelReasoningEffort === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={modelReasoningEffort === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showModelReasoningEffortSettings && showEffortSettings ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showEffortSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.effort')}
                                </div>
                                {claudeEffortOptions.map((option) => (
                                    <button
                                        key={option.value ?? 'auto'}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleEffortChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                effort === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {effort === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={effort === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </FloatingOverlay>
                </div>
            )
        }

        if (showQuickPrompts && showQuickPromptButton) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
                        <div className="py-2">
                            <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                {t('composer.quickPrompts')}
                            </div>
                            {quickPromptActions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    disabled={continueDisabled}
                                    className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                                        continueDisabled
                                            ? 'cursor-not-allowed opacity-50'
                                            : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                    }`}
                                    onClick={() => void handleQuickPrompt(action)}
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </FloatingOverlay>
                </div>
            )
        }

        if (suggestions.length > 0) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay>
                        <Autocomplete
                            suggestions={suggestions}
                            selectedIndex={selectedIndex}
                            onSelect={(index) => handleSuggestionSelect(index)}
                        />
                    </FloatingOverlay>
                </div>
            )
        }

        return null
    }, [
        showSettings,
        showQuickPrompts,
        showQuickPromptButton,
        showCollaborationSettings,
        showPermissionSettings,
        showModelSettings,
        showModelReasoningEffortSettings,
        showEffortSettings,
        modelOptions,
        codexReasoningEffortOptions,
        claudeEffortOptions,
        quickPromptActions,
        suggestions,
        selectedIndex,
        controlsDisabled,
        continueDisabled,
        collaborationMode,
        permissionMode,
        model,
        modelReasoningEffort,
        effort,
        collaborationModeOptions,
        permissionModeOptions,
        handleCollaborationChange,
        handlePermissionChange,
        handleModelChange,
        handleModelReasoningEffortChange,
        handleEffortChange,
        handleQuickPrompt,
        handleSuggestionSelect,
        showExpandedComposer,
        t
    ])

    return (
        <>
            <div className={`px-3 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)]`}>
                <div className="mx-auto w-full max-w-content">
                    <ComposerPrimitive.Root className="relative" onSubmit={handleSubmit}>
                        {overlays}

                        <StatusBar
                            active={active}
                            thinking={thinking}
                            agentState={agentState}
                            backgroundTaskCount={backgroundTaskCount}
                            contextSize={contextSize}
                            contextCacheRead={contextCacheRead}
                            contextWindow={contextWindow}
                            model={model}
                            modelReasoningEffort={modelReasoningEffort}
                            serviceTier={serviceTier}
                            permissionMode={permissionMode}
                            collaborationMode={collaborationMode}
                            agentFlavor={agentFlavor}
                            voiceStatus={voiceStatus}
                        />

                        <div className="overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)]">
                            {attachments.length > 0 ? (
                                <div className="flex flex-wrap gap-2 px-4 pt-3">
                                    <ComposerPrimitive.Attachments components={{ Attachment: AttachmentItem }} />
                                </div>
                            ) : null}

                            <div className="relative flex items-center px-4 py-3">
                                {showExpandedComposerTrigger ? (
                                    <button
                                        type="button"
                                        aria-label={t('composer.expand')}
                                        title={t('composer.expand')}
                                        disabled={controlsDisabled}
                                        className="absolute right-4 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => handleExpandedComposerOpenChange(true)}
                                    >
                                        <ExpandIcon />
                                    </button>
                                ) : null}

                                <ComposerPrimitive.Input
                                    ref={setCollapsedInputRef}
                                    autoFocus={!controlsDisabled && !isTouch}
                                    placeholder={showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')}
                                    disabled={controlsDisabled}
                                    minRows={collapsedComposerMinRows}
                                    maxRows={effectiveCollapsedComposerMaxRows}
                                    submitOnEnter={false}
                                    cancelOnEscape={false}
                                    onChange={handleChange}
                                    onFocus={() => {
                                        activeTextareaRef.current = collapsedTextareaRef.current
                                    }}
                                    onSelect={handleSelect}
                                    onKeyDown={handleKeyDown}
                                    onPaste={handlePaste}
                                    className={`flex-1 resize-none bg-transparent text-base leading-snug text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                                        showExpandedComposerTrigger ? 'pr-10' : ''
                                    }`}
                                />
                            </div>

                            {showCollapsedResizeControls ? (
                                <div className="flex items-center justify-between px-4 pb-1">
                                    <button
                                        type="button"
                                        aria-label={t('composer.resize')}
                                        title={t('composer.resizeHint')}
                                        disabled={controlsDisabled}
                                        className="flex min-h-11 items-center gap-1 rounded-full px-2 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                                        onPointerDown={handleCollapsedResizePointerDown}
                                    >
                                        <ResizeHandleIcon />
                                        <span>{t('composer.resizeHint')}</span>
                                    </button>
                                    <span className="text-[11px] text-[var(--app-hint)]">
                                        {t('composer.rememberHeight')}
                                    </span>
                                </div>
                            ) : null}

                            <ComposerButtons
                                canSend={canSend}
                                controlsDisabled={controlsDisabled}
                                showSettingsButton={showSettingsButton}
                                onSettingsToggle={handleSettingsToggle}
                                showTerminalButton={showTerminalButton}
                                terminalDisabled={terminalDisabled}
                                terminalLabel={terminalLabel}
                                onTerminal={onTerminal ?? (() => {})}
                                showAbortButton={showAbortButton}
                                abortDisabled={abortDisabled}
                                isAborting={isAborting}
                                onAbort={handleAbort}
                                showSwitchButton={showSwitchButton}
                                switchDisabled={switchDisabled}
                                isSwitching={isSwitching}
                                onSwitch={handleSwitch}
                                showContinueButton={showContinueButton}
                                continueDisabled={continueDisabled}
                                isContinuing={isContinuing}
                                onContinue={handleContinue}
                                showQuickPromptButton={showQuickPromptButton}
                                onQuickPromptToggle={handleQuickPromptToggle}
                                voiceEnabled={voiceEnabled}
                                voiceStatus={voiceStatus}
                                voiceMicMuted={voiceMicMuted}
                                onVoiceToggle={onVoiceToggle ?? (() => {})}
                                onVoiceMicToggle={onVoiceMicToggle}
                                onSend={handleSend}
                            />
                        </div>
                    </ComposerPrimitive.Root>
                </div>
            </div>

            <Dialog open={showExpandedComposer} onOpenChange={handleExpandedComposerOpenChange}>
                <DialogContent
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    className={`left-2 right-2 top-2 bottom-2 ${expandedComposerHeightClass} flex w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-[24px] p-0 sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:h-[82vh] sm:max-h-[82vh] sm:w-[calc(100vw-32px)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2`}
                >
                    <DialogHeader className="relative shrink-0 border-b border-[var(--app-border)] px-4 py-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left">
                        <DialogTitle className="text-[var(--app-fg)]">{t('composer.expandTitle')}</DialogTitle>
                        <DialogDescription>
                            {t('composer.expandDescription')}
                        </DialogDescription>
                        <button
                            type="button"
                            aria-label={t('composer.collapse')}
                            title={t('composer.collapse')}
                            className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            onClick={() => handleExpandedComposerOpenChange(false)}
                        >
                            <CloseIcon />
                        </button>
                    </DialogHeader>

                    <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--app-dialog-bg)] px-4 py-3">
                        {attachments.length > 0 ? (
                            <div className="shrink-0 flex flex-wrap gap-2 pb-3">
                                <ComposerPrimitive.Attachments components={{ Attachment: AttachmentItem }} />
                            </div>
                        ) : null}

                        <textarea
                            ref={expandedTextareaRef}
                            value={inputState.text}
                            placeholder={showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')}
                            disabled={controlsDisabled}
                            onChange={handleExpandedChange}
                            onFocus={() => {
                                activeTextareaRef.current = expandedTextareaRef.current
                            }}
                            onSelect={handleSelect}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            className="min-h-0 flex-1 resize-none rounded-[20px] border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3 text-base leading-7 text-[var(--app-fg)] placeholder-[var(--app-hint)] shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-50"
                        />

                        {suggestions.length > 0 ? (
                            <div className="pointer-events-none absolute inset-x-4 bottom-3">
                                <div className="pointer-events-auto">
                                    <FloatingOverlay maxHeight={260}>
                                        <Autocomplete
                                            suggestions={suggestions}
                                            selectedIndex={selectedIndex}
                                            onSelect={(index) => handleSuggestionSelect(index)}
                                        />
                                    </FloatingOverlay>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--app-border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
                        <Button type="button" onClick={sendComposer} disabled={!canSend}>
                            {t('composer.send')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
