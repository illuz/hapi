import { useEffect, useRef } from 'react'
import type { ApiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useSessionShareActions } from '@/hooks/mutations/useSessionShareActions'
import { useSessionShares } from '@/hooks/queries/useSessionShares'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

function formatDate(value: number | null): string {
    return value ? new Date(value).toLocaleString() : '—'
}

type SessionShareListPopoverProps = {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    sessionId: string
    onCreate: () => void
}

export function SessionShareListPopover(props: SessionShareListPopoverProps) {
    if (!props.isOpen) return null
    return <SessionShareListPopoverInner {...props} />
}

function SessionShareListPopoverInner(props: SessionShareListPopoverProps) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const ref = useRef<HTMLDivElement | null>(null)
    const { shares, isLoading, error } = useSessionShares(props.api, props.isOpen ? props.sessionId : null)
    const { revokeShare, isPending } = useSessionShareActions(props.api, props.sessionId)

    useEffect(() => {
        if (!props.isOpen) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target
            if (target instanceof Node && ref.current?.contains(target)) return
            props.onClose()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose()
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [props.isOpen, props.onClose])

    const copyUrl = async (url: string) => {
        try {
            await safeCopyToClipboard(url)
            addToast({
                title: t('share.toast.copied'),
                body: url,
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

    return (
        <div
            ref={ref}
            className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-24px))] rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 shadow-lg animate-menu-pop"
        >
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="font-semibold text-[var(--app-fg)]">{t('share.list.title')}</div>
                    <div className="text-xs text-[var(--app-hint)]">{t('share.list.subtitle')}</div>
                </div>
                <Button type="button" size="sm" onClick={props.onCreate}>{t('share.createShort')}</Button>
            </div>

            {isLoading ? (
                <div className="py-4 text-sm text-[var(--app-hint)]">{t('loading')}</div>
            ) : error ? (
                <div className="py-4 text-sm text-red-600">{error}</div>
            ) : shares.length === 0 ? (
                <div className="py-4 text-sm text-[var(--app-hint)]">{t('share.empty')}</div>
            ) : (
                <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                    {shares.map((share) => (
                        <div key={share.id} className="rounded-lg border border-[var(--app-border)] p-2.5 text-sm">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-[var(--app-fg)]">
                                        {share.label || t('share.untitled')}
                                    </div>
                                    <div className="text-xs text-[var(--app-hint)]">
                                        {t(`share.status.${share.status}`)} · {t('share.expiresAt')}: {formatDate(share.expiresAt)}
                                    </div>
                                </div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] ${share.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}>
                                    {t(`share.status.${share.status}`)}
                                </span>
                            </div>
                            <div className="mt-2 flex gap-2">
                                {share.url ? (
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void copyUrl(share.url!)}>
                                        {t('button.copy')}
                                    </Button>
                                ) : null}
                                {share.status === 'active' ? (
                                    <Button type="button" size="sm" variant="destructive" disabled={isPending} onClick={() => void revokeShare(share.id)}>
                                        {t('share.revoke')}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
