import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import {
    AUTO_CONTINUE_DEFAULT_REMAINING,
    normalizeAutoContinueKeywords,
    normalizeAutoContinuePrompt
} from '@/lib/autoContinue'

export function AutoContinueDialog(props: {
    isOpen: boolean
    onClose: () => void
    initialMaxRuns: number
    initialRemaining: number
    initialKeywords: string[]
    initialPrompt: string
    onSave: (settings: { maxRuns: number; remaining: number; keywords: string[]; prompt: string }) => void
}) {
    const { t } = useTranslation()
    const [maxRunsText, setMaxRunsText] = useState(String(props.initialMaxRuns))
    const [remainingText, setRemainingText] = useState(String(props.initialRemaining))
    const [keywordsText, setKeywordsText] = useState(props.initialKeywords.join('\n'))
    const [promptText, setPromptText] = useState(props.initialPrompt)
    const [error, setError] = useState<string | null>(null)
    const countInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!props.isOpen) return
        setMaxRunsText(String(props.initialMaxRuns))
        setRemainingText(String(props.initialRemaining))
        setKeywordsText(props.initialKeywords.join('\n'))
        setPromptText(props.initialPrompt)
        setError(null)
        setTimeout(() => countInputRef.current?.focus(), 100)
    }, [props.isOpen, props.initialMaxRuns, props.initialRemaining, props.initialKeywords, props.initialPrompt])

    const handleSave = () => {
        const maxRuns = Number.parseInt(maxRunsText, 10)
        const remaining = Number.parseInt(remainingText, 10)
        const keywords = normalizeAutoContinueKeywords(keywordsText.split(/\r?\n|,/g))
        const prompt = normalizeAutoContinuePrompt(promptText)

        if (!Number.isFinite(maxRuns) || maxRuns < 1) {
            setError(t('session.autoContinueErrorCount'))
            return
        }

        if (!Number.isFinite(remaining) || remaining < 0 || remaining > maxRuns) {
            setError(t('session.autoContinueErrorRemaining'))
            return
        }

        setError(null)
        props.onSave({ maxRuns, remaining, keywords, prompt })
        props.onClose()
    }

    const handleResetRemaining = () => {
        const maxRuns = Number.parseInt(maxRunsText, 10)
        setRemainingText(String(Number.isFinite(maxRuns) && maxRuns >= 1 ? maxRuns : AUTO_CONTINUE_DEFAULT_REMAINING))
        setError(null)
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('session.autoContinueSettings')}</DialogTitle>
                    <DialogDescription>
                        {t('session.autoContinueSettingsDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 flex flex-col gap-4">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[var(--app-fg)]">{t('session.autoContinueMaxRuns')}</span>
                        <input
                            ref={countInputRef}
                            type="number"
                            min={1}
                            value={maxRunsText}
                            onChange={(e) => setMaxRunsText(e.target.value)}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                        />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[var(--app-fg)]">{t('session.autoContinueRemaining')}</span>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                min={0}
                                value={remainingText}
                                onChange={(e) => setRemainingText(e.target.value)}
                                className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                            />
                            <Button type="button" variant="secondary" onClick={handleResetRemaining}>
                                {t('button.reset')}
                            </Button>
                        </div>
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[var(--app-fg)]">{t('session.autoContinueKeywords')}</span>
                        <textarea
                            rows={5}
                            value={keywordsText}
                            onChange={(e) => setKeywordsText(e.target.value)}
                            placeholder={t('session.autoContinueKeywordsPlaceholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                        />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[var(--app-fg)]">{t('session.autoContinuePrompt')}</span>
                        <textarea
                            rows={3}
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            placeholder={t('session.autoContinuePromptPlaceholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                        />
                    </label>

                    {error ? (
                        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={props.onClose}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="button" onClick={handleSave}>
                            {t('button.save')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
