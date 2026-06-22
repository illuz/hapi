import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

export function SharePasswordGate(props: {
    onSubmit: (password: string) => Promise<void>
    isPending: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    const [password, setPassword] = useState('')
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 100)
    }, [])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const trimmed = password.trim()
        if (!trimmed) return
        await props.onSubmit(trimmed)
    }

    return (
        <div className="flex min-h-full items-center justify-center bg-[var(--app-bg)] p-4">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-sm rounded-2xl border border-[var(--app-border)] bg-[var(--app-dialog-bg)] p-5 shadow-xl"
            >
                <div className="mb-1 text-lg font-semibold text-[var(--app-fg)]">
                    {t('share.guest.passwordTitle')}
                </div>
                <div className="mb-4 text-sm text-[var(--app-hint)]">
                    {t('share.guest.passwordHint')}
                </div>
                <input
                    ref={inputRef}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('share.guest.passwordPlaceholder')}
                    disabled={props.isPending}
                    className="mb-3 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                />
                {props.error ? (
                    <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {props.error}
                    </div>
                ) : null}
                <Button type="submit" className="w-full" disabled={props.isPending || !password.trim()}>
                    {props.isPending ? t('share.guest.unlocking') : t('share.guest.unlock')}
                </Button>
            </form>
        </div>
    )
}
