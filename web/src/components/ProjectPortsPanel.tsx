import { useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { PortMapping } from '@/types/api'
import { useProjectPortMappingActions } from '@/hooks/mutations/useProjectPortMappingActions'
import { useProjectPortMappings } from '@/hooks/queries/useProjectPortMappings'

const DEFAULT_DURATION_MINUTES = 30
const DEFAULT_PORT = '8080'

function getProjectName(projectPath: string): string {
    const parts = projectPath.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] || 'project'
}

function buildDefaultAlias(projectPath: string, port: string): string {
    const projectName = getProjectName(projectPath).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
    return `${projectName}_${port || DEFAULT_PORT}`.slice(0, 80)
}

function formatDuration(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    if (minutes < 60) return `${minutes} 分钟`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

function formatTime(timestamp: number | null | undefined): string {
    if (!timestamp) return '—'
    return new Date(timestamp).toLocaleString()
}

function getRemainingLabel(mapping: PortMapping): string {
    if (mapping.status !== 'active' || !mapping.expiresAt) return '已禁用'
    const remainingMs = mapping.expiresAt - Date.now()
    if (remainingMs <= 0) return '已到期'
    return `剩余 ${formatDuration(remainingMs)}`
}

function getStatusClass(status: PortMapping['status']): string {
    if (status === 'active') return 'bg-green-100 text-green-700 border-green-200'
    if (status === 'expired') return 'bg-orange-100 text-orange-700 border-orange-200'
    return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] border-[var(--app-border)]'
}

function openAccessUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
}

async function copyText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
}

export function ProjectPortsPanel(props: {
    api: ApiClient | null
    machineId: string
    projectPath: string
    onClose?: () => void
}) {
    const target = useMemo(() => ({ machineId: props.machineId, projectPath: props.projectPath }), [props.machineId, props.projectPath])
    const { mappings, isLoading, error, refetch } = useProjectPortMappings(props.api, target)
    const actions = useProjectPortMappingActions(props.api)
    const [port, setPort] = useState(DEFAULT_PORT)
    const [alias, setAlias] = useState(() => buildDefaultAlias(props.projectPath, DEFAULT_PORT))
    const [durationMinutes, setDurationMinutes] = useState(String(DEFAULT_DURATION_MINUTES))
    const [message, setMessage] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [lastAccessUrls, setLastAccessUrls] = useState<Record<string, string>>({})
    const [latestAccessUrl, setLatestAccessUrl] = useState<string | null>(null)

    const durationMs = Math.max(1, Number.parseInt(durationMinutes, 10) || DEFAULT_DURATION_MINUTES) * 60_000

    const resetFeedback = () => {
        setMessage(null)
        setActionError(null)
    }

    const createMapping = async () => {
        resetFeedback()
        const parsedPort = Number.parseInt(port, 10)
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
            setActionError('请输入 1-65535 之间的端口。')
            return
        }
        try {
            const result = await actions.createPortMapping({
                ...target,
                port: parsedPort,
                alias: alias.trim() || undefined,
                durationMs
            })
            if (result.accessUrl) {
                setLastAccessUrls((prev) => ({ ...prev, [result.mapping.id]: result.accessUrl! }))
                setLatestAccessUrl(result.accessUrl)
            }
            setMessage(`端口映射已创建，有效期 ${formatDuration(durationMs)}。`)
            setAlias(buildDefaultAlias(props.projectPath, port))
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '创建端口映射失败。')
        }
    }

    const checkPort = async () => {
        resetFeedback()
        const parsedPort = Number.parseInt(port, 10)
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
            setActionError('请输入 1-65535 之间的端口。')
            return
        }
        try {
            const result = await actions.checkPortMapping({ machineId: props.machineId, port: parsedPort })
            if (result.success) {
                setMessage(`127.0.0.1:${parsedPort} 可访问。`)
            } else {
                setActionError(result.error)
            }
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '端口检测失败。')
        }
    }

    const enableMapping = async (mapping: PortMapping, openAfter = false) => {
        resetFeedback()
        try {
            const result = await actions.enablePortMapping({ ...target, mappingId: mapping.id, durationMs: mapping.durationMs || durationMs })
            if (result.accessUrl) {
                setLastAccessUrls((prev) => ({ ...prev, [mapping.id]: result.accessUrl! }))
                setLatestAccessUrl(result.accessUrl)
                if (openAfter) openAccessUrl(result.accessUrl)
            }
            setMessage(`映射已启用，并续期 ${formatDuration(mapping.durationMs || durationMs)}。`)
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '启用端口映射失败。')
        }
    }

    const copyAccessUrl = async (mapping: PortMapping) => {
        resetFeedback()
        try {
            let url: string | undefined = lastAccessUrls[mapping.id]
            if (!url) {
                const result = await actions.enablePortMapping({ ...target, mappingId: mapping.id, durationMs: mapping.durationMs || durationMs })
                url = result.accessUrl
                if (url) {
                    setLastAccessUrls((prev) => ({ ...prev, [mapping.id]: url! }))
                    setLatestAccessUrl(url)
                }
            }
            if (!url) {
                setActionError('无法生成访问链接。')
                return
            }
            await copyText(url)
            setLatestAccessUrl(url)
            setMessage('访问链接已复制。')
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '复制访问链接失败。')
        }
    }

    const copyLatestAccessUrl = async () => {
        resetFeedback()
        if (!latestAccessUrl) {
            setActionError('暂无可复制的访问链接，请先创建或启用一个映射。')
            return
        }
        try {
            await copyText(latestAccessUrl)
            setMessage('访问链接已复制。')
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '复制访问链接失败。')
        }
    }

    const disableMapping = async (mapping: PortMapping) => {
        resetFeedback()
        try {
            await actions.disablePortMapping({ ...target, mappingId: mapping.id })
            setMessage('端口映射已禁用。')
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '禁用端口映射失败。')
        }
    }

    const deleteMapping = async (mapping: PortMapping) => {
        resetFeedback()
        try {
            await actions.deletePortMapping({ ...target, mappingId: mapping.id })
            setMessage('端口映射已删除。')
        } catch (err) {
            setActionError(err instanceof Error ? err.message : '删除端口映射失败。')
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)] text-[var(--app-fg)]">
            <div className="flex items-center gap-3 border-b border-[var(--app-border)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">端口映射</div>
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

            <div className="border-b border-[var(--app-border)] p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                    <label className="grid gap-1 text-xs text-[var(--app-hint)]">
                        端口
                        <input
                            value={port}
                            onChange={(event) => {
                                setPort(event.target.value)
                                setAlias(buildDefaultAlias(props.projectPath, event.target.value))
                            }}
                            inputMode="numeric"
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                            placeholder="8080"
                        />
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--app-hint)]">
                        子路径名
                        <input
                            value={alias}
                            onChange={(event) => setAlias(event.target.value)}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                            placeholder="ProjectName_8080"
                        />
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--app-hint)]">
                        有效期（分钟）
                        <input
                            value={durationMinutes}
                            onChange={(event) => setDurationMinutes(event.target.value)}
                            inputMode="numeric"
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                            placeholder="30"
                        />
                    </label>
                    <button
                        type="button"
                        disabled={actions.isPending}
                        onClick={() => void checkPort()}
                        className="self-end rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        检测
                    </button>
                    <button
                        type="button"
                        disabled={actions.isPending}
                        onClick={() => void createMapping()}
                        className="self-end rounded-lg bg-[var(--app-button)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50"
                    >
                        创建映射
                    </button>
                </div>
                <div className="mt-2 text-xs text-[var(--app-hint)]">
                    默认暴露 30 分钟。访问链接会通过一次性 token 设置临时 cookie，过期后代理自动拒绝访问。
                </div>
            </div>

            {error || actionError ? (
                <div className="mx-3 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {actionError ?? error}
                </div>
            ) : null}
            {message ? (
                <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
                    <span>{message}</span>
                    {latestAccessUrl ? (
                        <button
                            type="button"
                            onClick={() => void copyLatestAccessUrl()}
                            className="inline-flex items-center gap-1 rounded-md border border-green-300 bg-white/70 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-white"
                        >
                            <span aria-hidden="true">📋</span>
                            复制最新链接
                        </button>
                    ) : null}
                </div>
            ) : null}

            <div className="app-scroll-y flex-1 min-h-0 p-3">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">映射列表</h2>
                    <button type="button" onClick={refetch} className="text-xs text-[var(--app-link)]">刷新</button>
                </div>
                {isLoading ? <div className="text-sm text-[var(--app-hint)]">Loading port mappings…</div> : null}
                <div className="flex flex-col gap-3">
                    {mappings.map((mapping) => (
                        <div key={mapping.id} className="rounded-xl border border-[var(--app-border)] p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="truncate text-sm font-medium">/{mapping.alias}/</div>
                                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getStatusClass(mapping.status)}`}>
                                            {mapping.status}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--app-hint)]">
                                        127.0.0.1:{mapping.port} → /ports/{mapping.alias}/ · {getRemainingLabel(mapping)}
                                    </div>
                                    <div className="mt-1 text-xs text-[var(--app-hint)]">
                                        到期：{formatTime(mapping.expiresAt)} · 默认有效期：{formatDuration(mapping.durationMs)}
                                    </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                    <button type="button" className="text-xs text-[var(--app-link)]" onClick={() => void enableMapping(mapping, true)}>
                                        {mapping.status === 'active' ? '打开/续期' : `启用 ${formatDuration(mapping.durationMs)}`}
                                    </button>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--app-border)] px-2 py-1 text-xs font-medium text-[var(--app-link)] transition-colors hover:border-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                        disabled={actions.isPending}
                                        onClick={() => void copyAccessUrl(mapping)}
                                    >
                                        <span aria-hidden="true">📋</span>
                                        复制链接
                                    </button>
                                    {mapping.status === 'active' ? (
                                        <button type="button" className="text-xs text-[var(--app-hint)]" onClick={() => void disableMapping(mapping)}>
                                            禁用
                                        </button>
                                    ) : null}
                                    <button type="button" className="text-xs text-red-600" onClick={() => void deleteMapping(mapping)}>
                                        删除
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {mappings.length === 0 && !isLoading ? (
                        <div className="rounded-xl border border-dashed border-[var(--app-border)] p-4 text-sm text-[var(--app-hint)]">
                            还没有端口映射。输入端口，例如 8080，创建后即可通过子路径访问。
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
