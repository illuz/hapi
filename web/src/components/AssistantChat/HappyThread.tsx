import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import type { ConversationOutlineItem } from '@/chat/outline'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'
import { CloseIcon } from '@/components/icons'

type ScrollAnchor = {
    id: string
    topOffset: number
}

type PendingScrollRestore = {
    anchor: ScrollAnchor | null
    scrollTop: number
    scrollHeight: number
}

export type ConversationNavigationDirection = 'previous' | 'next'

const MESSAGE_ANCHOR_SELECTOR = '.happy-thread-messages > [id]'
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 120
const MANUAL_SCROLL_EPSILON_PX = 1
const INITIAL_SCROLL_SETTLE_MS = 1800
const INITIAL_SCROLL_SETTLE_DELAYS_MS = [0, 16, 50, 120, 250, 500, 900, 1400, 1800] as const
const CONVERSATION_NAVIGATION_EDGE_TOLERANCE_PX = 20
const CONVERSATION_NAVIGATION_LOAD_ATTEMPTS = 20
const CONVERSATION_NAVIGATION_SETTLE_DELAY_MS = 50

type ScrollIntent = {
    distanceFromBottom: number
    isNearBottom: boolean
    isScrollingUp: boolean
}

export function getScrollIntent(params: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    previousScrollTop: number
    thresholdPx?: number
}): ScrollIntent {
    const thresholdPx = params.thresholdPx ?? AUTO_SCROLL_RESUME_THRESHOLD_PX
    const distanceFromBottom = params.scrollHeight - params.scrollTop - params.clientHeight
    return {
        distanceFromBottom,
        isNearBottom: distanceFromBottom < thresholdPx,
        isScrollingUp: params.scrollTop < params.previousScrollTop - MANUAL_SCROLL_EPSILON_PX
    }
}

export function shouldCancelInitialScrollSettling(intent: ScrollIntent): boolean {
    return intent.isScrollingUp && intent.distanceFromBottom > MANUAL_SCROLL_EPSILON_PX
}

export function captureScrollAnchor(viewport: HTMLElement): ScrollAnchor | null {
    const viewportRect = viewport.getBoundingClientRect()
    const messages = Array.from(viewport.querySelectorAll<HTMLElement>(MESSAGE_ANCHOR_SELECTOR))
    for (const message of messages) {
        const rect = message.getBoundingClientRect()
        if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
            return {
                id: message.id,
                topOffset: rect.top - viewportRect.top
            }
        }
    }
    return null
}

export function restoreScrollAnchor(viewport: HTMLElement, anchor: ScrollAnchor): boolean {
    const target = document.getElementById(anchor.id)
    if (!target || !viewport.contains(target)) {
        return false
    }
    const viewportRect = viewport.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    viewport.scrollTop += targetRect.top - viewportRect.top - anchor.topOffset
    return true
}

export function findAdjacentConversationItem(params: {
    items: readonly ConversationOutlineItem[]
    direction: ConversationNavigationDirection
    viewportTop: number
    getTop: (item: ConversationOutlineItem) => number | null
    tolerancePx?: number
}): ConversationOutlineItem | null {
    const tolerancePx = params.tolerancePx ?? CONVERSATION_NAVIGATION_EDGE_TOLERANCE_PX
    if (params.direction === 'previous') {
        const threshold = params.viewportTop - tolerancePx
        for (let index = params.items.length - 1; index >= 0; index -= 1) {
            const top = params.getTop(params.items[index])
            if (top !== null && top < threshold) {
                return params.items[index]
            }
        }
        return null
    }

    const threshold = params.viewportTop + tolerancePx
    for (const item of params.items) {
        const top = params.getTop(item)
        if (top !== null && top > threshold) {
            return item
        }
    }
    return null
}

function waitForConversationNavigationSettle(): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, CONVERSATION_NAVIGATION_SETTLE_DELAY_MS)
    })
}

function ChevronUpIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m6 15 6-6 6 6" />
        </svg>
    )
}

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m6 9 6 6 6-6" />
        </svg>
    )
}

function DoubleChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m7 7 5 5 5-5" />
            <path d="m7 13 5 5 5-5" />
        </svg>
    )
}

function ConversationScrollButton(props: {
    label: string
    disabled?: boolean
    onClick: () => void
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={props.label}
            title={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-hint)] opacity-45 shadow-sm transition-[background-color,color,opacity] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] hover:opacity-95 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:cursor-not-allowed disabled:opacity-25"
        >
            {props.children}
        </button>
    )
}

function ConversationScrollControls(props: {
    disabled?: boolean
    previousLabel: string
    nextLabel: string
    bottomLabel: string
    onPrevious: () => void
    onNext: () => void
    onBottom: () => void
}) {
    return (
        <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-2">
            <ConversationScrollButton
                label={props.previousLabel}
                disabled={props.disabled}
                onClick={props.onPrevious}
            >
                <ChevronUpIcon />
            </ConversationScrollButton>
            <ConversationScrollButton
                label={props.nextLabel}
                disabled={props.disabled}
                onClick={props.onNext}
            >
                <ChevronDownIcon />
            </ConversationScrollButton>
            <ConversationScrollButton
                label={props.bottomLabel}
                disabled={props.disabled}
                onClick={props.onBottom}
            >
                <DoubleChevronDownIcon />
            </ConversationScrollButton>
        </div>
    )
}

function NewMessagesIndicator(props: { count: number; onClick: () => void }) {
    const { t } = useTranslation()
    if (props.count === 0) {
        return null
    }

    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-sm font-medium shadow-lg animate-bounce-in z-10"
        >
            {t('misc.newMessage', { n: props.count })} &#8595;
        </button>
    )
}

function MessageSkeleton() {
    const { t } = useTranslation()
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('misc.loadingMessages')}</span>
            <div className="space-y-3 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

export function ConversationOutlinePanel(props: {
    title: string
    items: readonly ConversationOutlineItem[]
    canForkFromOutline?: boolean
    forkingItemIndex?: number | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onForkFromItem?: (item: ConversationOutlineItem, index: number) => void | Promise<void>
    onLoadMore: () => void
    onSelect: (item: ConversationOutlineItem) => void
    onClose: () => void
}) {
    const { t } = useTranslation()

    return (
        <aside
            className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[24rem] flex-col border-l border-[var(--app-border)] bg-[var(--app-bg)] shadow-2xl sm:w-[24rem]"
            aria-label={t('session.outline.title')}
        >
            <div className="flex items-start gap-3 border-b border-[var(--app-border)] p-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{t('session.outline.title')}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{props.title}</div>
                </div>
                <button
                    type="button"
                    onClick={props.onClose}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('button.close')}
                    title={t('button.close')}
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>

            {props.hasMoreMessages ? (
                <div className="border-b border-[var(--app-border)] p-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={props.onLoadMore}
                        disabled={props.isLoadingMoreMessages}
                        aria-busy={props.isLoadingMoreMessages}
                        className="w-full gap-1.5 text-xs"
                    >
                        {props.isLoadingMoreMessages ? (
                            <>
                                <Spinner size="sm" label={null} className="text-current" />
                                {t('misc.loading')}
                            </>
                        ) : (
                            <>
                                <span aria-hidden="true">↑</span>
                                {t('session.outline.loadOlder')}
                            </>
                        )}
                    </Button>
                </div>
            ) : null}

            <div className="app-scroll-y min-h-0 flex-1 p-2">
                {props.items.length === 0 ? (
                    <div className="px-2 py-8 text-center text-sm text-[var(--app-hint)]">
                        {t('session.outline.empty')}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {props.items.map((item, index) => {
                            return (
                                <div
                                    key={item.id}
                                    className="group flex items-start gap-2 rounded-md transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    <button
                                        type="button"
                                        onClick={() => props.onSelect(item)}
                                        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                    >
                                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--app-button)]" aria-hidden="true" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[11px] font-medium uppercase text-[var(--app-hint)]">
                                                {t('session.outline.kind.user')}
                                            </span>
                                            <span className="line-clamp-2 text-sm leading-snug text-[var(--app-fg)]">
                                                {item.label}
                                            </span>
                                        </span>
                                    </button>
                                    {props.canForkFromOutline ? (
                                        <button
                                            type="button"
                                            disabled={props.forkingItemIndex !== null}
                                            onClick={() => props.onForkFromItem?.(item, index)}
                                            className="mr-2 mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                            title={t('session.outline.forkFromHere')}
                                            aria-label={t('session.outline.forkFromHere')}
                                            aria-busy={props.forkingItemIndex === index}
                                        >
                                            {props.forkingItemIndex === index ? (
                                                <Spinner size="sm" label={null} className="text-current" />
                                            ) : (
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
                                                    <path d="M9 3H5a2 2 0 0 0-2 2v4" />
                                                    <path d="M3 5l7 7" />
                                                    <path d="M21 12v7a2 2 0 0 1-2 2h-7" />
                                                    <path d="M14 14l7 7" />
                                                    <path d="M14 5h7v7" />
                                                    <path d="M21 5l-7 7" />
                                                </svg>
                                            )}
                                        </button>
                                    ) : null}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </aside>
    )
}

export function HappyThread(props: {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    pendingCount: number
    rawMessagesCount: number
    normalizedMessagesCount: number
    messagesVersion: number
    forceScrollToken: number
    outlineOpen: boolean
    outlineTitle: string
    outlineItems: readonly ConversationOutlineItem[]
    canForkFromOutline?: boolean
    outlineForkingItemIndex?: number | null
    onOutlineOpenChange: (open: boolean) => void
    onOutlineFork?: (item: ConversationOutlineItem, index: number) => void | Promise<void>
    onOutlineItemClick?: (item: ConversationOutlineItem) => void
}) {
    const { t } = useTranslation()
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const topSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const pendingScrollRef = useRef<PendingScrollRestore | null>(null)
    const prevLoadingMoreRef = useRef(false)
    const loadStartedRef = useRef(false)
    const isLoadingMoreRef = useRef(props.isLoadingMoreMessages)
    const hasMoreMessagesRef = useRef(props.hasMoreMessages)
    const isLoadingMessagesRef = useRef(props.isLoadingMessages)
    const onLoadMoreRef = useRef(props.onLoadMore)
    const handleLoadMoreRef = useRef<() => void>(() => {})
    const atBottomRef = useRef(true)
    const onAtBottomChangeRef = useRef(props.onAtBottomChange)
    const onFlushPendingRef = useRef(props.onFlushPending)
    const onRefreshRef = useRef(props.onRefresh)
    const forceScrollTokenRef = useRef(props.forceScrollToken)
    const lastScrollTopRef = useRef(0)
    const lastBottomRefreshAtRef = useRef(0)
    const bottomRefreshTimerRef = useRef<number | null>(null)
    const sessionIdRef = useRef(props.sessionId)
    const outlineItemsRef = useRef(props.outlineItems)
    const messagesVersionRef = useRef(props.messagesVersion)
    const conversationNavigationBusyRef = useRef(false)
    const initialScrollSessionRef = useRef<string | null>(null)
    const initialScrollDeadlineRef = useRef(0)
    const initialScrollTimersRef = useRef<number[]>([])
    const [conversationNavigationPending, setConversationNavigationPending] = useState<ConversationNavigationDirection | null>(null)

    // Smart scroll state: enabled only while the user is intentionally at the bottom.
    const autoScrollEnabledRef = useRef(true)
    useEffect(() => {
        onAtBottomChangeRef.current = props.onAtBottomChange
    }, [props.onAtBottomChange])
    useEffect(() => {
        onFlushPendingRef.current = props.onFlushPending
    }, [props.onFlushPending])
    useEffect(() => {
        onRefreshRef.current = props.onRefresh
    }, [props.onRefresh])
    useEffect(() => {
        hasMoreMessagesRef.current = props.hasMoreMessages
    }, [props.hasMoreMessages])
    useEffect(() => {
        isLoadingMessagesRef.current = props.isLoadingMessages
    }, [props.isLoadingMessages])
    useEffect(() => {
        onLoadMoreRef.current = props.onLoadMore
    }, [props.onLoadMore])
    useEffect(() => {
        outlineItemsRef.current = props.outlineItems
    }, [props.outlineItems])
    useEffect(() => {
        messagesVersionRef.current = props.messagesVersion
    }, [props.messagesVersion])

    useEffect(() => {
        sessionIdRef.current = props.sessionId
    }, [props.sessionId])

    const isInitialScrollSettling = useCallback(() => {
        return initialScrollSessionRef.current === sessionIdRef.current && Date.now() < initialScrollDeadlineRef.current
    }, [])

    const clearInitialScrollTimers = useCallback(() => {
        for (const timer of initialScrollTimersRef.current) {
            window.clearTimeout(timer)
        }
        initialScrollTimersRef.current = []
    }, [])

    const requestLatestWhileAtBottom = useCallback((force = false) => {
        const now = Date.now()
        if (!force && now - lastBottomRefreshAtRef.current < 1000) {
            return
        }
        if (bottomRefreshTimerRef.current !== null) {
            if (!force) {
                return
            }
            window.clearTimeout(bottomRefreshTimerRef.current)
            bottomRefreshTimerRef.current = null
        }
        lastBottomRefreshAtRef.current = now
        bottomRefreshTimerRef.current = window.setTimeout(() => {
            bottomRefreshTimerRef.current = null
            onRefreshRef.current()
        }, 0)
    }, [])

    useEffect(() => {
        return () => {
            if (bottomRefreshTimerRef.current !== null) {
                window.clearTimeout(bottomRefreshTimerRef.current)
                bottomRefreshTimerRef.current = null
            }
        }
    }, [])

    // Track scroll position to toggle autoScroll (stable listener using refs)
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        lastScrollTopRef.current = viewport.scrollTop

        const setAutoScrollMode = (enabled: boolean) => {
            if (autoScrollEnabledRef.current === enabled) {
                return
            }
            autoScrollEnabledRef.current = enabled
        }

        const setAtBottomMode = (atBottom: boolean) => {
            if (atBottom === atBottomRef.current) {
                return
            }
            atBottomRef.current = atBottom
            onAtBottomChangeRef.current(atBottom)
            if (atBottom) {
                onFlushPendingRef.current()
                requestLatestWhileAtBottom()
            }
        }

        const handleScroll = () => {
            const intent = getScrollIntent({
                scrollTop: viewport.scrollTop,
                scrollHeight: viewport.scrollHeight,
                clientHeight: viewport.clientHeight,
                previousScrollTop: lastScrollTopRef.current
            })
            lastScrollTopRef.current = viewport.scrollTop

            if (isInitialScrollSettling()) {
                if (shouldCancelInitialScrollSettling(intent)) {
                    initialScrollDeadlineRef.current = 0
                    clearInitialScrollTimers()
                    setAutoScrollMode(false)
                    setAtBottomMode(false)
                }
                return
            }

            if (intent.isScrollingUp && intent.distanceFromBottom > MANUAL_SCROLL_EPSILON_PX) {
                setAutoScrollMode(false)
                setAtBottomMode(false)
                return
            }

            if (intent.isNearBottom) {
                setAutoScrollMode(true)
                setAtBottomMode(true)
                return
            }

            setAutoScrollMode(false)
            setAtBottomMode(false)
        }

        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => viewport.removeEventListener('scroll', handleScroll)
    }, [requestLatestWhileAtBottom]) // Stable: reads current props from refs

    const scrollToBottomInstant = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' })
            lastScrollTopRef.current = viewport.scrollTop
        }
    }, [])

    // Scroll to bottom handler for the indicator button
    const scrollToBottom = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
            lastScrollTopRef.current = viewport.scrollTop
        }
        autoScrollEnabledRef.current = true
        if (!atBottomRef.current) {
            atBottomRef.current = true
            onAtBottomChangeRef.current(true)
        }
        onFlushPendingRef.current()
    }, [])

    const markAwayFromBottom = useCallback(() => {
        autoScrollEnabledRef.current = false
        if (atBottomRef.current) {
            atBottomRef.current = false
            onAtBottomChangeRef.current(false)
        }
    }, [])

    const scrollToConversationItem = useCallback((item: ConversationOutlineItem) => {
        const target = document.getElementById(getConversationMessageAnchorId(item.targetMessageId))
        const viewport = viewportRef.current
        if (!target || !viewport || !viewport.contains(target)) {
            return false
        }
        markAwayFromBottom()
        target.scrollIntoView({ block: 'start', behavior: 'smooth' })
        return true
    }, [markAwayFromBottom])

    const scrollToTop = useCallback(() => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        markAwayFromBottom()
        viewport.scrollTo({ top: 0, behavior: 'smooth' })
        lastScrollTopRef.current = viewport.scrollTop
    }, [markAwayFromBottom])

    const scrollToLatestAndRefresh = useCallback(() => {
        scrollToBottom()
        requestLatestWhileAtBottom(true)
    }, [requestLatestWhileAtBottom, scrollToBottom])

    const findLoadedConversationNavigationTarget = useCallback((direction: ConversationNavigationDirection) => {
        const viewport = viewportRef.current
        if (!viewport) {
            return null
        }
        const viewportTop = viewport.getBoundingClientRect().top
        return findAdjacentConversationItem({
            items: outlineItemsRef.current,
            direction,
            viewportTop,
            getTop: (item) => {
                const element = document.getElementById(getConversationMessageAnchorId(item.targetMessageId))
                if (!element || !viewport.contains(element)) {
                    return null
                }
                return element.getBoundingClientRect().top
            }
        })
    }, [])

    const waitForMessageWindowUpdate = useCallback(async (previousVersion: number) => {
        for (let attempt = 0; attempt < CONVERSATION_NAVIGATION_LOAD_ATTEMPTS; attempt += 1) {
            await waitForConversationNavigationSettle()
            if (messagesVersionRef.current !== previousVersion || (!isLoadingMoreRef.current && !loadLockRef.current)) {
                return
            }
        }
    }, [])

    // Reset state when session changes
    useLayoutEffect(() => {
        autoScrollEnabledRef.current = true
        lastScrollTopRef.current = viewportRef.current?.scrollTop ?? 0
        atBottomRef.current = true
        onAtBottomChangeRef.current(true)
        forceScrollTokenRef.current = props.forceScrollToken
        initialScrollSessionRef.current = null
        initialScrollDeadlineRef.current = 0
        clearInitialScrollTimers()
    }, [props.sessionId, clearInitialScrollTimers])

    useEffect(() => {
        requestLatestWhileAtBottom()
    }, [props.sessionId, requestLatestWhileAtBottom])

    useLayoutEffect(() => {
        if (
            initialScrollSessionRef.current === props.sessionId
            || props.isLoadingMessages
            || props.rawMessagesCount === 0
            || pendingScrollRef.current
        ) {
            return
        }

        initialScrollSessionRef.current = props.sessionId
        autoScrollEnabledRef.current = true
        atBottomRef.current = true
        onAtBottomChangeRef.current(true)
        scrollToBottomInstant()
        requestLatestWhileAtBottom()

        initialScrollDeadlineRef.current = Date.now() + INITIAL_SCROLL_SETTLE_MS
        clearInitialScrollTimers()
        initialScrollTimersRef.current = INITIAL_SCROLL_SETTLE_DELAYS_MS.map((delay) => window.setTimeout(() => {
            if (
                initialScrollSessionRef.current !== props.sessionId
                || !autoScrollEnabledRef.current
                || pendingScrollRef.current
            ) {
                return
            }
            scrollToBottomInstant()
        }, delay))
    }, [
        props.sessionId,
        props.isLoadingMessages,
        props.rawMessagesCount,
        props.messagesVersion,
        scrollToBottomInstant,
        requestLatestWhileAtBottom,
        clearInitialScrollTimers
    ])

    useEffect(() => {
        return () => {
            clearInitialScrollTimers()
        }
    }, [clearInitialScrollTimers])

    useEffect(() => {
        if (forceScrollTokenRef.current === props.forceScrollToken) {
            return
        }
        forceScrollTokenRef.current = props.forceScrollToken
        scrollToBottom()
    }, [props.forceScrollToken, scrollToBottom])

    const loadOlderMessages = useCallback(async () => {
        if (
            isInitialScrollSettling()
            || isLoadingMessagesRef.current
            || !hasMoreMessagesRef.current
            || isLoadingMoreRef.current
            || loadLockRef.current
        ) {
            return false
        }
        const viewport = viewportRef.current
        if (!viewport) {
            return false
        }
        pendingScrollRef.current = {
            anchor: captureScrollAnchor(viewport),
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight
        }
        autoScrollEnabledRef.current = false
        loadLockRef.current = true
        loadStartedRef.current = false
        let loadPromise: Promise<unknown>
        try {
            loadPromise = onLoadMoreRef.current()
        } catch (error) {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
            return false
        }
        return loadPromise.then(() => true).catch((error) => {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
            return false
        }).finally(() => {
            if (!loadStartedRef.current && !isLoadingMoreRef.current && pendingScrollRef.current) {
                pendingScrollRef.current = null
                loadLockRef.current = false
            }
        })
    }, [isInitialScrollSettling])

    const handleLoadMore = useCallback(() => {
        void loadOlderMessages()
    }, [loadOlderMessages])

    const handlePreviousConversation = useCallback(() => {
        if (conversationNavigationBusyRef.current) {
            return
        }
        conversationNavigationBusyRef.current = true
        setConversationNavigationPending('previous')

        void (async () => {
            try {
                const loadedTarget = findLoadedConversationNavigationTarget('previous')
                if (loadedTarget && scrollToConversationItem(loadedTarget)) {
                    return
                }

                let firstKnownItemId = outlineItemsRef.current[0]?.id ?? null
                for (let attempt = 0; attempt < CONVERSATION_NAVIGATION_LOAD_ATTEMPTS; attempt += 1) {
                    if (!hasMoreMessagesRef.current) {
                        break
                    }

                    const previousVersion = messagesVersionRef.current
                    const didStartLoad = await loadOlderMessages()
                    await waitForMessageWindowUpdate(previousVersion)
                    if (!didStartLoad && previousVersion === messagesVersionRef.current) {
                        break
                    }

                    const items = outlineItemsRef.current
                    let target: ConversationOutlineItem | null = null
                    if (firstKnownItemId) {
                        const firstKnownIndex = items.findIndex((item) => item.id === firstKnownItemId)
                        if (firstKnownIndex > 0) {
                            target = items[firstKnownIndex - 1]
                        } else if (firstKnownIndex === -1 && items.length > 0) {
                            target = items[items.length - 1]
                        }
                    } else if (items.length > 0) {
                        target = items[items.length - 1]
                    }

                    target = target ?? findLoadedConversationNavigationTarget('previous')
                    if (target && scrollToConversationItem(target)) {
                        return
                    }
                    firstKnownItemId = items[0]?.id ?? firstKnownItemId
                }

                scrollToTop()
            } finally {
                conversationNavigationBusyRef.current = false
                setConversationNavigationPending(null)
            }
        })()
    }, [
        findLoadedConversationNavigationTarget,
        loadOlderMessages,
        scrollToConversationItem,
        scrollToTop,
        waitForMessageWindowUpdate
    ])

    const handleNextConversation = useCallback(() => {
        if (conversationNavigationBusyRef.current) {
            return
        }
        const loadedTarget = findLoadedConversationNavigationTarget('next')
        if (loadedTarget && scrollToConversationItem(loadedTarget)) {
            return
        }
        scrollToLatestAndRefresh()
    }, [findLoadedConversationNavigationTarget, scrollToConversationItem, scrollToLatestAndRefresh])

    const handleOutlineSelect = useCallback((item: ConversationOutlineItem) => {
        const target = document.getElementById(getConversationMessageAnchorId(item.targetMessageId))
        if (target) {
            target.scrollIntoView({ block: 'start', behavior: 'smooth' })
            autoScrollEnabledRef.current = false
        }
        props.onOutlineItemClick?.(item)
        props.onOutlineOpenChange(false)
    }, [props.onOutlineItemClick, props.onOutlineOpenChange])

    useEffect(() => {
        handleLoadMoreRef.current = handleLoadMore
    }, [handleLoadMore])

    useEffect(() => {
        const sentinel = topSentinelRef.current
        const viewport = viewportRef.current
        if (!sentinel || !viewport || !props.hasMoreMessages || props.isLoadingMessages) {
            return
        }
        if (typeof IntersectionObserver === 'undefined') {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        if (isInitialScrollSettling()) {
                            continue
                        }
                        handleLoadMoreRef.current()
                    }
                }
            },
            {
                root: viewport,
                rootMargin: '200px 0px 0px 0px'
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [props.hasMoreMessages, props.isLoadingMessages, isInitialScrollSettling])

    useEffect(() => {
        const content = contentRef.current
        if (!content || typeof ResizeObserver === 'undefined') {
            return
        }

        const observer = new ResizeObserver(() => {
            if (isInitialScrollSettling() && autoScrollEnabledRef.current && !pendingScrollRef.current) {
                scrollToBottomInstant()
            }
        })
        observer.observe(content)
        return () => observer.disconnect()
    }, [isInitialScrollSettling, scrollToBottomInstant])

    useLayoutEffect(() => {
        const pending = pendingScrollRef.current
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        if (pending) {
            const restoredByAnchor = pending.anchor ? restoreScrollAnchor(viewport, pending.anchor) : false
            if (!restoredByAnchor) {
                const delta = viewport.scrollHeight - pending.scrollHeight
                viewport.scrollTop = pending.scrollTop + delta
            }
            lastScrollTopRef.current = viewport.scrollTop
            pendingScrollRef.current = null
            loadLockRef.current = false
            return
        }
        if (atBottomRef.current && autoScrollEnabledRef.current) {
            scrollToBottomInstant()
        }
    }, [props.messagesVersion, scrollToBottomInstant])

    useEffect(() => {
        isLoadingMoreRef.current = props.isLoadingMoreMessages
        if (props.isLoadingMoreMessages) {
            loadStartedRef.current = true
        }
        if (prevLoadingMoreRef.current && !props.isLoadingMoreMessages && pendingScrollRef.current) {
            pendingScrollRef.current = null
            loadLockRef.current = false
        }
        prevLoadingMoreRef.current = props.isLoadingMoreMessages
    }, [props.isLoadingMoreMessages])

    const showSkeleton = props.isLoadingMessages && props.rawMessagesCount === 0 && props.pendingCount === 0

    return (
        <HappyChatProvider value={{
            api: props.api,
            sessionId: props.sessionId,
            metadata: props.metadata,
            disabled: props.disabled,
            onRefresh: props.onRefresh,
            onRetryMessage: props.onRetryMessage
        }}>
            <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col relative">
                <ThreadPrimitive.Viewport
                    asChild
                    autoScroll={false}
                    scrollToBottomOnInitialize={false}
                    scrollToBottomOnRunStart={false}
                    scrollToBottomOnThreadSwitch={false}
                >
                    <div ref={viewportRef} className="app-scroll-y min-h-0 flex-1 overflow-x-hidden">
                        <div ref={contentRef} className="mx-auto w-full max-w-content min-w-0 p-3">
                            <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />
                            {showSkeleton ? (
                                <MessageSkeleton />
                            ) : (
                                <>
                                    {props.messagesWarning ? (
                                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                            {props.messagesWarning}
                                        </div>
                                    ) : null}

                                    {props.hasMoreMessages && !props.isLoadingMessages ? (
                                        <div className="py-1 mb-2">
                                            <div className="mx-auto w-fit">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleLoadMore}
                                                    disabled={props.isLoadingMoreMessages || props.isLoadingMessages}
                                                    aria-busy={props.isLoadingMoreMessages}
                                                    className="gap-1.5 text-xs opacity-80 hover:opacity-100"
                                                >
                                                    {props.isLoadingMoreMessages ? (
                                                        <>
                                                            <Spinner size="sm" label={null} className="text-current" />
                                                            {t('misc.loading')}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span aria-hidden="true">↑</span>
                                                            {t('misc.loadOlder')}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    {import.meta.env.DEV && props.normalizedMessagesCount === 0 && props.rawMessagesCount > 0 ? (
                                        <div className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs">
                                            Message normalization returned 0 items for {props.rawMessagesCount} messages (see `web/src/chat/normalize.ts`).
                                        </div>
                                    ) : null}
                                </>
                            )}
                            <div className="happy-thread-messages flex flex-col gap-3">
                                <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
                            </div>
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                <ConversationScrollControls
                    disabled={conversationNavigationPending !== null || props.isLoadingMessages}
                    previousLabel={t('session.scroll.previousUser')}
                    nextLabel={t('session.scroll.nextUser')}
                    bottomLabel={t('session.scroll.bottom')}
                    onPrevious={handlePreviousConversation}
                    onNext={handleNextConversation}
                    onBottom={scrollToLatestAndRefresh}
                />
                <NewMessagesIndicator count={props.pendingCount} onClick={scrollToBottom} />
                {props.outlineOpen ? (
                    <>
                        <button
                            type="button"
                            className="absolute inset-0 z-20 bg-black/20"
                            aria-label={t('session.outline.close')}
                            onClick={() => props.onOutlineOpenChange(false)}
                        />
                        <ConversationOutlinePanel
                            title={props.outlineTitle}
                            items={props.outlineItems}
                            canForkFromOutline={props.canForkFromOutline}
                            forkingItemIndex={props.outlineForkingItemIndex}
                            hasMoreMessages={props.hasMoreMessages}
                            isLoadingMoreMessages={props.isLoadingMoreMessages}
                            onForkFromItem={props.onOutlineFork}
                            onLoadMore={handleLoadMore}
                            onSelect={handleOutlineSelect}
                            onClose={() => props.onOutlineOpenChange(false)}
                        />
                    </>
                ) : null}
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
