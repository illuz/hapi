import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionUnavailableState } from '@/components/SessionUnavailableState'
import { SessionList } from '@/components/SessionList'
import { SessionSidebarMoreMenu } from '@/components/SessionSidebarMoreMenu'
import { SessionManagementPanel } from '@/components/SessionManagementPanel'
import { ProjectToolsPanel } from '@/components/ProjectToolsPanel'
import { NewSession } from '@/components/NewSession'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useProjectToolCounts } from '@/hooks/queries/useProjectTools'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { clearMessageWindow, fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'
import { getMachineTitle } from '@/lib/machineTitle'
import { filterSessionsByActivityOrMarker } from '@/lib/sessionFilters'
import { loadSessionColorFilterPreference } from '@/lib/sessionColorFilterPreference'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsPage from '@/routes/settings'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ShareClient } from '@/api/shareClient'
import { SharePasswordGate } from '@/components/share/SharePasswordGate'
import { SharedSessionChat } from '@/components/share/SharedSessionChat'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
    )
}

function HapiLogo(props: { className?: string }) {
    return (
        <div className={`flex items-center ${props.className ?? ''}`}>
            <img
                src="/icon.svg"
                alt="HAPI"
                className="h-7 w-7 rounded-md shadow-sm"
            />
        </div>
    )
}

function SessionsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { sessions, isLoading, error, refetch } = useSessions(api)
    const { machines } = useMachines(api, true)
    const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false)
    const [isCleaningInactive, setIsCleaningInactive] = useState(false)
    const [activityFilterEnabled, setActivityFilterEnabled] = useState(true)
    const [lastViewedSessionId, setLastViewedSessionId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null
        return window.sessionStorage.getItem('hapi-last-viewed-session-id')
    })

    const handleRefresh = useCallback(() => {
        void refetch()
    }, [refetch])

    const machineLabelsById = useMemo(() => {
        const labels: Record<string, string> = {}
        for (const machine of machines) {
            labels[machine.id] = getMachineTitle(machine)
        }
        return labels
    }, [machines])
    const filteredSessions = useMemo(
        () => filterSessionsByActivityOrMarker(sessions, activityFilterEnabled),
        [activityFilterEnabled, sessions]
    )
    const filteredProjectCount = useMemo(() => new Set(filteredSessions.map(s =>
        s.metadata?.worktree?.basePath ?? s.metadata?.path ?? 'Other'
    )).size, [filteredSessions])
    const visibleProjectToolTargets = useMemo(() => {
        const seen = new Set<string>()
        const targets: Array<{ machineId: string; projectPath: string }> = []
        for (const session of filteredSessions) {
            const machineId = session.metadata?.machineId
            const projectPath = session.metadata?.worktree?.basePath ?? session.metadata?.path
            if (!machineId || !projectPath) {
                continue
            }
            const key = `${machineId}::${projectPath}`
            if (seen.has(key)) {
                continue
            }
            seen.add(key)
            targets.push({ machineId, projectPath })
        }
        return targets
    }, [filteredSessions])
    const { countsByKey: projectToolCountsByKey } = useProjectToolCounts(api, visibleProjectToolTargets)

    const handleToggleFilter = useCallback(() => {
        setActivityFilterEnabled(previous => !previous)
    }, [])

    const inactiveSessions = useMemo(
        () => sessions.filter((session) => !session.active && !session.markerColor),
        [sessions]
    )
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const routeSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'
    const selectedSessionId = routeSessionId ?? (isSessionsIndex ? lastViewedSessionId : null)

    useEffect(() => {
        if (!routeSessionId) return
        setLastViewedSessionId(routeSessionId)
        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem('hapi-last-viewed-session-id', routeSessionId)
        }
    }, [routeSessionId])

    const handleCleanupInactive = useCallback(async () => {
        if (!api) {
            throw new Error('API unavailable')
        }
        if (inactiveSessions.length === 0) {
            return
        }

        setIsCleaningInactive(true)
        try {
            const deletedSessionIds: string[] = []
            for (const session of inactiveSessions) {
                await api.deleteSession(session.id)
                deletedSessionIds.push(session.id)
                queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
                clearMessageWindow(session.id)
            }

            if (selectedSessionId && deletedSessionIds.includes(selectedSessionId)) {
                navigate({ to: '/sessions', replace: true })
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        } finally {
            setIsCleaningInactive(false)
        }
    }, [api, inactiveSessions, navigate, queryClient, selectedSessionId])
    const sidebar = useSidebarResize()

    return (
        <div className="flex h-full min-h-0">
            <div
                className={`${isSessionsIndex ? 'flex' : 'hidden lg:flex'} w-full shrink-0 flex-col bg-[var(--app-bg)]`}
                style={{ '--sidebar-w': `${sidebar.width}px` } as React.CSSProperties}
            >
                <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                    <div className="mx-auto w-full max-w-content flex items-center justify-between px-3 py-2">
                        <div className="flex min-w-0 items-center gap-3">
                            <HapiLogo className="shrink-0" />
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('sessions.count', { n: filteredSessions.length, m: filteredProjectCount })}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleToggleFilter}
                                aria-pressed={activityFilterEnabled}
                                className={`p-1.5 rounded-full transition-colors ${activityFilterEnabled ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                                title={activityFilterEnabled ? t('sessions.showAll') : t('sessions.filterActiveOrMarked')}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={isLoading}
                                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                title={t('sessions.refresh')}
                            >
                                <RefreshIcon className="h-5 w-5" />
                            </button>
                            <SessionSidebarMoreMenu
                                isDeleteDisabled={inactiveSessions.length === 0 || isCleaningInactive}
                                onBrowse={() => navigate({ to: '/browse' })}
                                onManageSessions={() => navigate({ to: '/sessions/manage' })}
                                onSettings={() => navigate({ to: '/settings' })}
                                onCleanupInactive={() => setCleanupDialogOpen(true)}
                                onNewSession={() => navigate({ to: '/sessions/new' })}
                            />
                        </div>
                    </div>
                </div>

                <div className="app-scroll-y flex-1 min-h-0 desktop-scrollbar-left">
                    {error ? (
                        <div className="mx-auto w-full max-w-content px-3 py-2">
                            <div className="text-sm text-red-600">{error}</div>
                        </div>
                    ) : null}
                    <SessionList
                        sessions={filteredSessions}
                        selectedSessionId={selectedSessionId}
                        onSelect={(sessionId) => navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId },
                        })}
                        onNewSession={() => navigate({ to: '/sessions/new' })}
                        onBrowse={() => navigate({ to: '/browse' })}
                        onRefresh={handleRefresh}
                        isLoading={isLoading}
                        renderHeader={false}
                        api={api}
                        machineLabelsById={machineLabelsById}
                        projectToolCountsByKey={projectToolCountsByKey}
                        onOpenProjectTools={({ machineId, projectPath, tab }) => navigate({
                            to: '/sessions/project-tools',
                            search: { machineId, projectPath, tab }
                        })}
                    />
                </div>
            </div>

            {/* Resize handle - desktop only */}
            <div
                className="sidebar-resize-handle hidden lg:block shrink-0"
                data-dragging={sidebar.isDragging || undefined}
                onPointerDown={sidebar.onPointerDown}
            />

            <div className={`${isSessionsIndex ? 'hidden lg:flex' : 'flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}>
                <div className="flex-1 min-h-0">
                    <Outlet />
                </div>
            </div>

            <ConfirmDialog
                isOpen={cleanupDialogOpen}
                onClose={() => setCleanupDialogOpen(false)}
                title={t('dialog.cleanupInactive.title')}
                description={t('dialog.cleanupInactive.description', { count: inactiveSessions.length })}
                confirmLabel={t('dialog.cleanupInactive.confirm')}
                confirmingLabel={t('dialog.cleanupInactive.confirming')}
                onConfirm={handleCleanupInactive}
                isPending={isCleaningInactive}
                destructive
            />
        </div>
    )
}

function SessionsIndexPage() {
    return null
}

function ProjectToolsRoutePage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const search = projectToolsRoute.useSearch()

    if (!search.machineId || !search.projectPath) {
        return (
            <SessionUnavailableState
                error="Choose a project from the session list to manage Agents and Cron."
                onBack={() => { void navigate({ to: '/sessions' }) }}
            />
        )
    }

    return (
        <ProjectToolsPanel
            api={api}
            machineId={search.machineId}
            projectPath={search.projectPath}
            initialTab={search.tab}
            onClose={goBack}
            onOpenSession={(sessionId) => navigate({
                to: '/sessions/$sessionId',
                params: { sessionId }
            })}
        />
    )
}

function SessionManageRoutePage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const { sessions, isLoading } = useSessions(api)
    const { machines } = useMachines(api, true)

    const machineLabelsById = useMemo(() => {
        const labels: Record<string, string> = {}
        for (const machine of machines) {
            labels[machine.id] = getMachineTitle(machine)
        }
        return labels
    }, [machines])

    return (
        <SessionManagementPanel
            api={api}
            sessions={sessions}
            machineLabelsById={machineLabelsById}
            isLoading={isLoading}
            onClose={goBack}
        />
    )
}

function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const {
        session,
        isLoading: sessionLoading,
        isNotFound: sessionNotFound,
        error: sessionError,
        refetch: refetchSession,
    } = useSession(api, sessionId)
    const {
        messages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(api, sessionId)
    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        isSessionThinking: session?.thinking ?? false,
        onSuccess: (sentSessionId) => {
            clearDraftsAfterSend(sentSessionId, sessionId)
        },
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId, { permissionMode: session.permissionMode ?? undefined })
            } catch (error) {
                const message = error instanceof Error ? error.message : t('dialog.error.default')
                addToast({
                    title: t('resume.failed.title'),
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (api) {
                    if (session && resolvedSessionId !== session.id) {
                        seedMessageWindowFromSession(session.id, resolvedSessionId)
                        queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                            session: { ...session, id: resolvedSessionId, active: true }
                        })
                    }
                    try {
                        await Promise.all([
                            queryClient.prefetchQuery({
                                queryKey: queryKeys.session(resolvedSessionId),
                                queryFn: () => api.getSession(resolvedSessionId),
                            }),
                            fetchLatestMessages(api, resolvedSessionId),
                        ])
                    } catch {
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resolvedSessionId },
                    replace: true
                })
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        commands: slashCommands,
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    if (!session) {
        if (sessionLoading) {
            return (
                <div className="flex-1 flex items-center justify-center p-4">
                    <LoadingState label={t('loading.session')} className="text-sm" />
                </div>
            )
        }

        return (
            <SessionUnavailableState
                error={sessionError}
                isNotFound={sessionNotFound}
                onBack={goBack}
                onRetry={refreshSelectedSession}
            />
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            messagesVersion={messagesVersion}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            availableSlashCommands={slashCommands}
        />
    )
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()
    const { directory: initialDirectory, machineId: initialMachineId } = newSessionRoute.useSearch()
    const inheritedMarkerColor = loadSessionColorFilterPreference()

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({ to: '/sessions', replace: true })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
            })
        })
    }, [navigate, queryClient])

    const handleChooseFolder = useCallback((args: { machineId: string | null; directory: string }) => {
        // Forward the currently-selected machine so /browse opens scoped to
        // it rather than falling back to `hapi:lastMachineId`, which can
        // disagree if the user changed machines without yet creating a
        // session.
        navigate({
            to: '/browse',
            search: args.machineId ? { machineId: args.machineId } : {}
        })
    }, [navigate])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {machinesError ? (
                    <div className="p-3 text-sm text-red-600">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    onCancel={handleCancel}
                    onSuccess={handleSuccess}
                    onChooseFolder={handleChooseFolder}
                    initialDirectory={initialDirectory}
                    initialMachineId={initialMachineId}
                    inheritedMarkerColor={inheritedMarkerColor}
                />
            </div>
        </div>
    )
}

function BrowsePage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { machines, isLoading: machinesLoading } = useMachines(api, true)
    const { t } = useTranslation()
    const { machineId: initialMachineId } = browseRoute.useSearch()

    const handleStartSession = useCallback((machineId: string, directory: string) => {
        navigate({
            to: '/sessions/new',
            search: { directory, machineId }
        })
    }, [navigate])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('browse.title')}</div>
            </div>

            <div className="flex-1 min-h-0">
                <WorkspaceBrowser
                    api={api}
                    machines={machines}
                    machinesLoading={machinesLoading}
                    onStartSession={handleStartSession}
                    initialMachineId={initialMachineId}
                />
            </div>
        </div>
    )
}

function getStoredShareToken(routeToken: string): string | null {
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem(`hapi-share-token:${routeToken}`)
}

function setStoredShareToken(routeToken: string, guestToken: string | null): void {
    if (typeof window === 'undefined') return
    const key = `hapi-share-token:${routeToken}`
    if (guestToken) {
        window.sessionStorage.setItem(key, guestToken)
    } else {
        window.sessionStorage.removeItem(key)
    }
}

function SharedRoutePage() {
    const { token } = useParams({ from: '/share/$token' })
    const { t } = useTranslation()
    const client = useMemo(() => new ShareClient(token), [token])
    const [guestToken, setGuestToken] = useState<string | null>(() => getStoredShareToken(token))
    const [authError, setAuthError] = useState<string | null>(null)
    const [authPending, setAuthPending] = useState(false)

    const handleAuthenticate = async (password: string) => {
        setAuthPending(true)
        setAuthError(null)
        try {
            const response = await client.authenticate(password)
            setStoredShareToken(token, response.token)
            setGuestToken(response.token)
        } catch {
            setStoredShareToken(token, null)
            setGuestToken(null)
            setAuthError(t('share.guest.authFailed'))
        } finally {
            setAuthPending(false)
        }
    }

    const handleUnauthorized = () => {
        setStoredShareToken(token, null)
        setGuestToken(null)
        setAuthError(t('share.guest.authFailed'))
    }

    if (!guestToken) {
        return (
            <SharePasswordGate
                onSubmit={handleAuthenticate}
                isPending={authPending}
                error={authError}
            />
        )
    }

    return (
        <SharedSessionChat
            client={client}
            guestToken={guestToken}
            onUnauthorized={handleUnauthorized}
        />
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" search={(previous) => previous} replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

type ProjectToolsSearch = {
    machineId?: string
    projectPath?: string
    tab?: 'agents' | 'cron' | 'runs'
}

const projectToolsRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'project-tools',
    validateSearch: (search: Record<string, unknown>): ProjectToolsSearch => {
        const result: ProjectToolsSearch = {}
        if (typeof search.machineId === 'string' && search.machineId) {
            result.machineId = search.machineId
        }
        if (typeof search.projectPath === 'string' && search.projectPath) {
            result.projectPath = search.projectPath
        }
        if (search.tab === 'cron' || search.tab === 'runs' || search.tab === 'agents') {
            result.tab = search.tab
        }
        return result
    },
    component: ProjectToolsRoutePage,
})

const sessionManageRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'manage',
    component: SessionManageRoutePage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        return tab ? { tab } : {}
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        return result
    },
    component: FilePage,
})

type NewSessionSearch = {
    directory?: string
    machineId?: string
}

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    validateSearch: (search: Record<string, unknown>): NewSessionSearch => {
        const result: NewSessionSearch = {}
        if (typeof search.directory === 'string' && search.directory) {
            result.directory = search.directory
        }
        if (typeof search.machineId === 'string' && search.machineId) {
            result.machineId = search.machineId
        }
        return result
    },
    component: NewSessionPage,
})

const browseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/browse',
    validateSearch: (search: Record<string, unknown>): { machineId?: string } => {
        if (typeof search.machineId === 'string' && search.machineId) {
            return { machineId: search.machineId }
        }
        return {}
    },
    component: BrowsePage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

const shareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/share/$token',
    component: SharedRoutePage,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionManageRoute,
        projectToolsRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    browseRoute,
    shareRoute,
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
