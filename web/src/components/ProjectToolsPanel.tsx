import { useEffect, useMemo, useState } from 'react'
import type { ProjectAgentConfig, ProjectCronConfig, ProjectToolKind, PermissionMode } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useProjectToolsActions } from '@/hooks/mutations/useProjectToolsActions'
import { useCronRuns, useProjectTools } from '@/hooks/queries/useProjectTools'

type ProjectToolsPanelTab = 'agents' | 'cron' | 'runs'

type ProjectToolTarget = {
    machineId: string
    projectPath: string
}

type ToolDraft = {
    id: string
    name: string
    prompt: string
    agent: ProjectAgentConfig['agent']
    model: string
    effort: string
    modelReasoningEffort: string
    permissionMode: PermissionMode
    enabled: boolean
    scheduleType: 'manual' | 'interval' | 'daily'
    everyMinutes: string
    dailyTime: string
    timezone: string
}

const AGENT_OPTIONS: Array<NonNullable<ProjectAgentConfig['agent']>> = ['claude', 'codex', 'cursor', 'gemini', 'opencode']
const PERMISSION_MODE_OPTIONS: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'ask', 'read-only', 'safe-yolo', 'yolo']

const EMPTY_DRAFT: ToolDraft = {
    id: '',
    name: '',
    prompt: '',
    agent: 'claude',
    model: '',
    effort: '',
    modelReasoningEffort: '',
    permissionMode: 'default',
    enabled: true,
    scheduleType: 'manual',
    everyMinutes: '60',
    dailyTime: '09:00',
    timezone: '',
}

function normalizeTab(tab?: string | null): ProjectToolsPanelTab {
    return tab === 'cron' || tab === 'runs' ? tab : 'agents'
}

function createDraftFromAgent(config: ProjectAgentConfig): ToolDraft {
    return {
        ...EMPTY_DRAFT,
        id: config.id,
        name: config.name ?? '',
        prompt: config.prompt,
        agent: config.agent ?? 'claude',
        model: config.model ?? '',
        effort: config.effort ?? '',
        modelReasoningEffort: config.modelReasoningEffort ?? '',
        permissionMode: config.permissionMode ?? 'default',
        enabled: config.enabled !== false,
    }
}

function createDraftFromCron(config: ProjectCronConfig): ToolDraft {
    const draft: ToolDraft = {
        ...createDraftFromAgent(config),
        scheduleType: config.schedule.type,
    }
    if (config.schedule.type === 'interval') {
        draft.everyMinutes = String(config.schedule.everyMinutes)
    }
    if (config.schedule.type === 'daily') {
        draft.dailyTime = config.schedule.time
        draft.timezone = config.schedule.timezone ?? ''
    }
    return draft
}

function getToolTitle(config: ProjectAgentConfig | ProjectCronConfig): string {
    return config.name?.trim() || config.id
}

function formatSchedule(config: ProjectCronConfig): string {
    if (config.schedule.type === 'manual') {
        return 'Manual'
    }
    if (config.schedule.type === 'interval') {
        return `Every ${config.schedule.everyMinutes} min`
    }
    return `Daily ${config.schedule.time}${config.schedule.timezone ? ` ${config.schedule.timezone}` : ''}`
}

function formatTime(value: number | null | undefined): string {
    if (!value) {
        return '—'
    }
    return new Date(value).toLocaleString()
}

function isDangerousPermissionMode(mode?: string): boolean {
    return mode === 'yolo' || mode === 'bypassPermissions'
}

function buildConfig(kind: ProjectToolKind, draft: ToolDraft): ProjectAgentConfig | ProjectCronConfig {
    const base = {
        id: draft.id.trim(),
        name: draft.name.trim() || undefined,
        prompt: draft.prompt.trim(),
        agent: draft.agent,
        model: draft.model.trim() || undefined,
        effort: draft.effort.trim() || undefined,
        modelReasoningEffort: draft.modelReasoningEffort.trim() || undefined,
        permissionMode: draft.permissionMode,
        enabled: draft.enabled,
    }
    if (kind === 'agent') {
        return base
    }
    const schedule: ProjectCronConfig['schedule'] = draft.scheduleType === 'interval'
        ? { type: 'interval', everyMinutes: Math.max(1, Number.parseInt(draft.everyMinutes, 10) || 1) }
        : draft.scheduleType === 'daily'
            ? { type: 'daily', time: draft.dailyTime || '09:00', timezone: draft.timezone.trim() || undefined }
            : { type: 'manual' }
    return { ...base, schedule }
}

function FormField(props: {
    label: string
    children: React.ReactNode
}) {
    return (
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--app-hint)]">
            {props.label}
            {props.children}
        </label>
    )
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={`rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] ${props.className ?? ''}`}
        />
    )
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className={`rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] ${props.className ?? ''}`}
        />
    )
}

export function ProjectToolsPanel(props: {
    api: ApiClient | null
    machineId: string
    projectPath: string
    initialTab?: string | null
    onClose?: () => void
    onOpenSession?: (sessionId: string) => void
}) {
    const target = useMemo<ProjectToolTarget>(() => ({
        machineId: props.machineId,
        projectPath: props.projectPath
    }), [props.machineId, props.projectPath])
    const [tab, setTab] = useState<ProjectToolsPanelTab>(() => normalizeTab(props.initialTab))
    const [editingKind, setEditingKind] = useState<ProjectToolKind>('agent')
    const [editingHash, setEditingHash] = useState<string | null>(null)
    const [draft, setDraft] = useState<ToolDraft>(EMPTY_DRAFT)
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const agentsQuery = useProjectTools(props.api, target, 'agent')
    const cronQuery = useProjectTools(props.api, target, 'cron')
    const runsQuery = useCronRuns(props.api, target, { limit: 100 })
    const actions = useProjectToolsActions(props.api)

    useEffect(() => {
        setTab(normalizeTab(props.initialTab))
        setIsFormOpen(false)
    }, [props.initialTab])

    const agents = agentsQuery.data?.success ? agentsQuery.data.items : []
    const crons = cronQuery.data?.success ? cronQuery.data.items : []

    const resetDraft = (kind: ProjectToolKind = editingKind) => {
        setEditingKind(kind)
        setEditingHash(null)
        setDraft({ ...EMPTY_DRAFT })
        setError(null)
        setSuccess(null)
    }

    const openNewDraft = (kind: ProjectToolKind) => {
        resetDraft(kind)
        setIsFormOpen(true)
    }

    const closeDraft = () => {
        resetDraft(editingKind)
        setIsFormOpen(false)
    }

    const selectTab = (nextTab: ProjectToolsPanelTab) => {
        setTab(nextTab)
        setIsFormOpen(false)
        setError(null)
        setSuccess(null)
    }

    const editAgent = (config: ProjectAgentConfig, hash?: string) => {
        setEditingKind('agent')
        setEditingHash(hash ?? null)
        setDraft(createDraftFromAgent(config))
        setTab('agents')
        setIsFormOpen(true)
        setError(null)
        setSuccess(null)
    }

    const editCron = (config: ProjectCronConfig, hash?: string) => {
        setEditingKind('cron')
        setEditingHash(hash ?? null)
        setDraft(createDraftFromCron(config))
        setTab('cron')
        setIsFormOpen(true)
        setError(null)
        setSuccess(null)
    }

    const saveDraft = async () => {
        setError(null)
        setSuccess(null)
        if (!draft.id.trim() || !draft.prompt.trim()) {
            setError('ID and prompt are required.')
            return
        }
        try {
            await actions.upsertProjectTool({
                ...target,
                kind: editingKind,
                config: buildConfig(editingKind, draft),
                expectedHash: editingHash,
            })
            setSuccess(`${editingKind === 'agent' ? 'Agent' : 'Cron'} saved.`)
            resetDraft(editingKind)
            setIsFormOpen(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save project tool.')
        }
    }

    const deleteTool = async (kind: ProjectToolKind, id: string, hash?: string) => {
        setError(null)
        setSuccess(null)
        try {
            await actions.deleteProjectTool({ ...target, kind, id, expectedHash: hash })
            setSuccess(`${kind === 'agent' ? 'Agent' : 'Cron'} deleted.`)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete project tool.')
        }
    }

    const startAgent = async (agentId: string) => {
        setError(null)
        setSuccess(null)
        try {
            const result = await actions.startProjectAgent({ ...target, agentId })
            setSuccess('Agent started.')
            if (result.type === 'success') {
                props.onOpenSession?.(result.sessionId)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start agent.')
        }
    }

    const runCron = async (cronId: string) => {
        setError(null)
        setSuccess(null)
        try {
            const result = await actions.runProjectCron({ ...target, cronId })
            setSuccess('Cron run started.')
            if (result.type === 'success' && result.sessionId) {
                props.onOpenSession?.(result.sessionId)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to run cron.')
        }
    }

    const formKindLabel = editingKind === 'agent' ? 'Agent' : 'Cron'

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)] text-[var(--app-fg)]">
            <div className="flex items-center gap-3 border-b border-[var(--app-border)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Project Tools</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{props.projectPath}</div>
                </div>
                {props.onClose ? (
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-lg px-3 py-1.5 text-sm text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    >
                        Close
                    </button>
                ) : null}
            </div>

            <div className="flex gap-2 border-b border-[var(--app-border)] px-3 py-2">
                {(['agents', 'cron', 'runs'] as const).map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => selectTab(item)}
                        className={`rounded-full px-3 py-1 text-sm transition-colors ${tab === item ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                    >
                        {item === 'agents' ? `Agents (${agents.length})` : item === 'cron' ? `Cron (${crons.length})` : 'Runs'}
                    </button>
                ))}
            </div>

            {error ? (
                <div className="mx-3 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            ) : null}
            {success ? (
                <div className="mx-3 mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
                    {success}
                </div>
            ) : null}

            <div className="app-scroll-y flex-1 min-h-0 p-3">
                {tab === 'agents' ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold">Agents</h2>
                            <button type="button" className="text-xs text-[var(--app-link)]" onClick={() => openNewDraft('agent')}>
                                New agent
                            </button>
                        </div>
                        {agentsQuery.error ? <div className="text-sm text-red-600">{agentsQuery.error}</div> : null}
                        {agentsQuery.isLoading ? <div className="text-sm text-[var(--app-hint)]">Loading agents…</div> : null}
                        {agents.map((item) => (
                            <div key={item.id} className="rounded-xl border border-[var(--app-border)] p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{getToolTitle(item.config)}</div>
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {item.config.agent ?? 'claude'} · {item.config.permissionMode ?? 'default'} · {item.config.enabled === false ? 'disabled' : 'enabled'}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <button type="button" className="text-xs text-[var(--app-link)]" onClick={() => void startAgent(item.id)}>
                                            Start
                                        </button>
                                        <button type="button" className="text-xs text-[var(--app-hint)]" onClick={() => editAgent(item.config, item.hash)}>
                                            Edit
                                        </button>
                                        <button type="button" className="text-xs text-red-600" onClick={() => void deleteTool('agent', item.id, item.hash)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {agents.length === 0 && !agentsQuery.isLoading ? (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] p-4 text-sm text-[var(--app-hint)]">
                                No project agents yet.
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {tab === 'cron' ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold">Cron</h2>
                            <button type="button" className="text-xs text-[var(--app-link)]" onClick={() => openNewDraft('cron')}>
                                New cron
                            </button>
                        </div>
                        {cronQuery.error ? <div className="text-sm text-red-600">{cronQuery.error}</div> : null}
                        {cronQuery.isLoading ? <div className="text-sm text-[var(--app-hint)]">Loading cron…</div> : null}
                        {crons.map((item) => (
                            <div key={item.id} className="rounded-xl border border-[var(--app-border)] p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{getToolTitle(item.config)}</div>
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {formatSchedule(item.config)} · {item.config.permissionMode ?? 'default'} · {item.config.enabled === false ? 'disabled' : 'enabled'}
                                        </div>
                                        {isDangerousPermissionMode(item.config.permissionMode) ? (
                                            <div className="mt-2 rounded-lg border border-orange-300 bg-orange-50 px-2 py-1 text-xs text-orange-700">
                                                Warning: this cron can run with elevated permissions.
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <button type="button" className="text-xs text-[var(--app-link)]" onClick={() => void runCron(item.id)}>
                                            Run
                                        </button>
                                        <button type="button" className="text-xs text-[var(--app-hint)]" onClick={() => editCron(item.config, item.hash)}>
                                            Edit
                                        </button>
                                        <button type="button" className="text-xs text-red-600" onClick={() => void deleteTool('cron', item.id, item.hash)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {crons.length === 0 && !cronQuery.isLoading ? (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] p-4 text-sm text-[var(--app-hint)]">
                                No project cron jobs yet.
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {tab === 'runs' ? (
                    <div className="flex flex-col gap-3">
                        <h2 className="text-sm font-semibold">Cron Runs</h2>
                        {runsQuery.error ? <div className="text-sm text-red-600">{runsQuery.error}</div> : null}
                        {runsQuery.isLoading ? <div className="text-sm text-[var(--app-hint)]">Loading runs…</div> : null}
                        {runsQuery.runs.map((run) => (
                            <div key={run.id} className="rounded-xl border border-[var(--app-border)] p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium">{run.cronId}</div>
                                    <div className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs text-[var(--app-hint)]">{run.status}</div>
                                </div>
                                <div className="mt-2 grid gap-1 text-xs text-[var(--app-hint)]">
                                    <div>Queued: {formatTime(run.queuedAt)}</div>
                                    <div>Started: {formatTime(run.startedAt)}</div>
                                    <div>Finished: {formatTime(run.finishedAt)}</div>
                                    {run.sessionId ? (
                                        <button type="button" className="w-fit text-[var(--app-link)]" onClick={() => props.onOpenSession?.(run.sessionId!)}>
                                            Open session {run.sessionId.slice(0, 8)}
                                        </button>
                                    ) : null}
                                    {run.error ? <div className="text-red-600">Error: {run.error}</div> : null}
                                </div>
                            </div>
                        ))}
                        {runsQuery.runs.length === 0 && !runsQuery.isLoading ? (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] p-4 text-sm text-[var(--app-hint)]">
                                No cron runs yet.
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {isFormOpen && (tab === 'agents' || tab === 'cron') ? (
                <div className="border-t border-[var(--app-border)] p-3">
                    <div className="mb-2 text-sm font-semibold">{editingHash ? `Edit ${formKindLabel}` : `New ${formKindLabel}`}</div>
                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                            <FormField label="ID">
                                <TextInput value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="reviewer" />
                            </FormField>
                            <FormField label="Name">
                                <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Code reviewer" />
                            </FormField>
                        </div>
                        <FormField label="Prompt">
                            <textarea
                                value={draft.prompt}
                                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                                placeholder="Describe what this tool should do…"
                                rows={3}
                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                            />
                        </FormField>
                        <div className="grid grid-cols-2 gap-2">
                            <FormField label="Agent">
                                <SelectInput value={draft.agent} onChange={(event) => setDraft({ ...draft, agent: event.target.value as ToolDraft['agent'] })}>
                                    {AGENT_OPTIONS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                                </SelectInput>
                            </FormField>
                            <FormField label="Permission">
                                <SelectInput value={draft.permissionMode} onChange={(event) => setDraft({ ...draft, permissionMode: event.target.value as PermissionMode })}>
                                    {PERMISSION_MODE_OPTIONS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                                </SelectInput>
                            </FormField>
                        </div>
                        {isDangerousPermissionMode(draft.permissionMode) ? (
                            <div className="rounded-lg border border-orange-300 bg-orange-50 px-2 py-1 text-xs text-orange-700">
                                Warning: yolo/bypass permissions can modify files without confirmation.
                            </div>
                        ) : null}
                        <div className="grid grid-cols-3 gap-2">
                            <FormField label="Model">
                                <TextInput value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="optional" />
                            </FormField>
                            <FormField label="Effort">
                                <TextInput value={draft.effort} onChange={(event) => setDraft({ ...draft, effort: event.target.value })} placeholder="optional" />
                            </FormField>
                            <FormField label="Reasoning">
                                <TextInput value={draft.modelReasoningEffort} onChange={(event) => setDraft({ ...draft, modelReasoningEffort: event.target.value })} placeholder="optional" />
                            </FormField>
                        </div>
                        {editingKind === 'cron' ? (
                            <div className="grid grid-cols-3 gap-2">
                                <FormField label="Schedule">
                                    <SelectInput value={draft.scheduleType} onChange={(event) => setDraft({ ...draft, scheduleType: event.target.value as ToolDraft['scheduleType'] })}>
                                        <option value="manual">manual</option>
                                        <option value="interval">interval</option>
                                        <option value="daily">daily</option>
                                    </SelectInput>
                                </FormField>
                                {draft.scheduleType === 'interval' ? (
                                    <FormField label="Every minutes">
                                        <TextInput type="number" min="1" value={draft.everyMinutes} onChange={(event) => setDraft({ ...draft, everyMinutes: event.target.value })} />
                                    </FormField>
                                ) : null}
                                {draft.scheduleType === 'daily' ? (
                                    <>
                                        <FormField label="Time">
                                            <TextInput value={draft.dailyTime} onChange={(event) => setDraft({ ...draft, dailyTime: event.target.value })} placeholder="09:00" />
                                        </FormField>
                                        <FormField label="Timezone">
                                            <TextInput value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} placeholder="optional" />
                                        </FormField>
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                        <label className="flex items-center gap-2 text-sm text-[var(--app-fg)]">
                            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                            Enabled
                        </label>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={closeDraft} className="rounded-lg px-3 py-1.5 text-sm text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]">
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveDraft()}
                                disabled={actions.isPending}
                                className="rounded-lg bg-[var(--app-button)] px-3 py-1.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50"
                            >
                                {actions.isPending ? 'Saving…' : `Save ${formKindLabel}`}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
