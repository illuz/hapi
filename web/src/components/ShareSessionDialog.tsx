import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionShare } from '@/types/api'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { useSessionShareActions } from '@/hooks/mutations/useSessionShareActions'
import { useSessionShares } from '@/hooks/queries/useSessionShares'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

function formatShareDate(value: number | null): string {
    if (!value) return '—'
    return new Date(value).toLocaleString()
}

function addDays(days: number): number {
    return Date.now() + days * 24 * 60 * 60 * 1000
}

type ExpiryOption = 'never' | '1d' | '7d' | '30d'

function resolveExpiry(option: ExpiryOption): number | null {
    if (option === '1d') return addDays(1)
    if (option === '7d') return addDays(7)
    if (option === '30d') return addDays(30)
    return null
}

type ShareSessionDialogProps = {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    sessionId: string
    sessionTitle: string
    initialMode?: 'create' | 'manage'
}

export function ShareSessionDialog(props: ShareSessionDialogProps) {
    if (!props.isOpen) return null
    return <ShareSessionDialogInner {...props} />
}

function ShareSessionDialogInner(props: ShareSessionDialogProps) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { shares, isLoading } = useSessionShares(props.api, props.isOpen ? props.sessionId : null)
    const { createShare, revokeShare, isPending } = useSessionShareActions(props.api, props.sessionId)
    const [label, setLabel] = useState('')
    const [password, setPassword] = useState('')
    const [includeHistory, setIncludeHistory] = useState(false)
    const [expiry, setExpiry] = useState<ExpiryOption>('never')
    const [createdShare, setCreatedShare] = useState<SessionShare | null>(null)
    const [error, setError] = useState<string | null>(null)
    const passwordRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (!props.isOpen) return
        setLabel('')
        setPassword('')
        setIncludeHistory(false)
        setExpiry('never')
        setCreatedShare(null)
        setError(null)
        setTimeout(() => passwordRef.current?.focus(), 100)
    }, [props.isOpen])

    const copyUrl = async (share: SessionShare) => {
        if (!share.url) return
        try {
            await safeCopyToClipboard(share.url)
            addToast({
                title: t('share.toast.copied'),
                body: share.url,
                sessionId: props.sessionId,
                url: `/sessions/${props.sessionId}`,
                kind: 'message'
            })
        } catch {
            addToast({
                title: t('share.toast.copyFailed'),
                body: t('dialog.error.default'),
                sessionId: props.sessionId,
                url: `/sessions/${props.sessionId}`,
                kind: 'failure'
            })
        }
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const trimmedPassword = password.trim()
        if (!trimmedPassword) {
            setError(t('share.error.passwordRequired'))
            return
        }
        setError(null)
        try {
            const share = await createShare({
                password: trimmedPassword,
                label: label.trim() || null,
                expiresAt: resolveExpiry(expiry),
                includeHistory
            })
            setCreatedShare(share)
            setPassword('')
            await copyUrl(share)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('share.error.createFailed'))
        }
    }

    const handleRevoke = async (shareId: string) => {
        try {
            await revokeShare(shareId)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('dialog.error.default'))
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('share.dialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('share.dialog.description', { name: props.sessionTitle })}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-2">
                        <label className="text-sm font-medium text-[var(--app-fg)]" htmlFor="share-label">
                            {t('share.label')}
                        </label>
                        <input
                            id="share-label"
                            value={label}
                            onChange={(event) => setLabel(event.target.value)}
                            maxLength={120}
                            placeholder={t('share.label.placeholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                            disabled={isPending}
                        />
                    </div>

                    <div className="grid gap-2">
                        <label className="text-sm font-medium text-[var(--app-fg)]" htmlFor="share-password">
                            {t('share.password')}
                        </label>
                        <input
                            id="share-password"
                            ref={passwordRef}
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            maxLength={255}
                            placeholder={t('share.password.placeholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                            disabled={isPending}
                        />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)]">
                            <input
                                type="checkbox"
                                checked={includeHistory}
                                onChange={(event) => setIncludeHistory(event.target.checked)}
                                disabled={isPending}
                            />
                            {t('share.includeHistory')}
                        </label>

                        <select
                            value={expiry}
                            onChange={(event) => setExpiry(event.target.value as ExpiryOption)}
                            disabled={isPending}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                            aria-label={t('share.expires')}
                        >
                            <option value="never">{t('share.expires.never')}</option>
                            <option value="1d">{t('share.expires.1d')}</option>
                            <option value="7d">{t('share.expires.7d')}</option>
                            <option value="30d">{t('share.expires.30d')}</option>
                        </select>
                    </div>

                    {error ? (
                        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {error}
                        </div>
                    ) : null}

                    {createdShare?.url ? (
                        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3">
                            <div className="mb-2 text-sm font-medium text-[var(--app-fg)]">{t('share.created')}</div>
                            <div className="break-all rounded-md bg-[var(--app-bg)] p-2 text-xs text-[var(--app-hint)]">
                                {createdShare.url}
                            </div>
                            <Button type="button" size="sm" className="mt-2" onClick={() => void copyUrl(createdShare)}>
                                {t('button.copy')}
                            </Button>
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                            {t('button.close')}
                        </Button>
                        <Button type="submit" disabled={isPending || !password.trim()}>
                            {isPending ? t('share.creating') : t('share.create')}
                        </Button>
                    </div>
                </form>

                <div className="mt-5 border-t border-[var(--app-divider)] pt-4">
                    <div className="mb-2 text-sm font-semibold text-[var(--app-fg)]">{t('share.activeShares')}</div>
                    {isLoading ? (
                        <div className="text-sm text-[var(--app-hint)]">{t('loading')}</div>
                    ) : shares.length === 0 ? (
                        <div className="text-sm text-[var(--app-hint)]">{t('share.empty')}</div>
                    ) : (
                        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                            {shares.map((share) => (
                                <div key={share.id} className="rounded-lg border border-[var(--app-border)] p-3 text-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-[var(--app-fg)]">
                                                {share.label || t('share.untitled')}
                                            </div>
                                            <div className="text-xs text-[var(--app-hint)]">
                                                {t(`share.status.${share.status}`)} · {t('share.expiresAt')}: {formatShareDate(share.expiresAt)}
                                            </div>
                                            {share.lastUsedAt ? (
                                                <div className="text-xs text-[var(--app-hint)]">
                                                    {t('share.lastUsedAt')}: {formatShareDate(share.lastUsedAt)}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            {share.url ? (
                                                <Button type="button" size="sm" variant="secondary" onClick={() => void copyUrl(share)}>
                                                    {t('button.copy')}
                                                </Button>
                                            ) : null}
                                            {share.status === 'active' ? (
                                                <Button type="button" size="sm" variant="destructive" onClick={() => void handleRevoke(share.id)} disabled={isPending}>
                                                    {t('share.revoke')}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
