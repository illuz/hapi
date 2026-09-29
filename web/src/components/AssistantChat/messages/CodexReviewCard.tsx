import type { CodexReview, CodexReviewFinding } from '@/chat/types'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function formatPercent(value: number | null): string | null {
    if (value === null || !Number.isFinite(value)) return null
    return `${Math.round(value * 100)}%`
}

function formatLocation(finding: CodexReviewFinding): string | null {
    if (!finding.filePath) return null
    if (finding.lineStart === null) return finding.filePath
    if (finding.lineEnd !== null && finding.lineEnd !== finding.lineStart) {
        return `${finding.filePath}:${finding.lineStart}-${finding.lineEnd}`
    }
    return `${finding.filePath}:${finding.lineStart}`
}

function priorityClass(priority: number | null): string {
    if (priority === 0 || priority === 1) {
        return 'border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
    }
    if (priority === 2) {
        return 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
    }
    return 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
}

function Badge(props: { children: string; className?: string }) {
    return (
        <span className={cn('inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4', props.className)}>
            {props.children}
        </span>
    )
}

function FindingItem(props: { finding: CodexReviewFinding }) {
    const { t } = useTranslation()
    const location = formatLocation(props.finding)
    const confidence = formatPercent(props.finding.confidenceScore)
    return (
        <li className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
            <div className="flex min-w-0 flex-wrap items-start gap-2">
                {props.finding.priority !== null ? (
                    <Badge className={priorityClass(props.finding.priority)}>{`P${props.finding.priority}`}</Badge>
                ) : null}
                <div className="min-w-0 flex-1 text-sm font-semibold leading-6 text-[var(--app-fg)]">{props.finding.title}</div>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--app-fg)]">{props.finding.body}</p>
            <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--app-hint)]">
                <span className="min-w-0 break-all font-mono">{location ?? t('codexReview.location.missing')}</span>
                {confidence ? <span>{t('codexReview.confidence', { value: confidence })}</span> : null}
            </div>
        </li>
    )
}

export function CodexReviewCard(props: { review: CodexReview }) {
    const { t } = useTranslation()
    const confidence = formatPercent(props.review.overallConfidenceScore)
    const findingCount = props.review.findings.length
    return (
        <section className="my-1 max-w-full overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]">
            <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2">
                <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--app-fg)]">{t('codexReview.title')}</div>
                {props.review.overallCorrectness ? (
                    <Badge className="border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)]">{props.review.overallCorrectness}</Badge>
                ) : null}
                {confidence ? <Badge className="border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-hint)]">{confidence}</Badge> : null}
            </div>
            <div className="px-3 py-3">
                {props.review.overallExplanation ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--app-fg)]">{props.review.overallExplanation}</p>
                ) : null}
                <div className={cn('text-xs font-medium text-[var(--app-hint)]', props.review.overallExplanation ? 'mt-3' : '')}>
                    {t('codexReview.findings', { count: findingCount })}
                </div>
                {findingCount > 0 ? (
                    <ol className="mt-2 space-y-2">
                        {props.review.findings.map((finding, index) => <FindingItem key={`${finding.title}:${index}`} finding={finding} />)}
                    </ol>
                ) : null}
            </div>
        </section>
    )
}

