import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

type SessionUnavailableStateProps = {
    error: string | null
    isNotFound?: boolean
    onBack: () => void
    onRetry?: () => void
}

export function SessionUnavailableState(props: SessionUnavailableStateProps) {
    const { t } = useTranslation()
    const message = props.isNotFound
        ? t('session.unavailable.notFound')
        : (props.error ?? t('session.unavailable.generic'))

    return (
        <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-4 text-center shadow-sm">
                <div className="text-base font-semibold text-[var(--app-fg)]">
                    {t('session.unavailable.title')}
                </div>
                <div className="mt-2 text-sm text-[var(--app-hint)]">
                    {message}
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button type="button" onClick={props.onBack}>
                        {t('session.unavailable.back')}
                    </Button>
                    {props.onRetry ? (
                        <Button type="button" variant="secondary" onClick={props.onRetry}>
                            {t('session.unavailable.retry')}
                        </Button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
