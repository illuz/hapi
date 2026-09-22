import type { EventPresentation } from '@/chat/presentation'

export function EventPresentationView(props: { presentation: EventPresentation }) {
    const { presentation } = props
    const label = (
        <span className="inline-flex items-center gap-1">
            {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
            <span>{presentation.text}</span>
        </span>
    )

    if (!presentation.details || presentation.details.length === 0) {
        return label
    }

    return (
        <details className="group text-left">
            <summary className="cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-1.5">
                    {label}
                    <span
                        aria-hidden="true"
                        className="inline-block text-[10px] transition-transform group-open:rotate-90"
                    >
                        ▶
                    </span>
                </span>
            </summary>
            <div className="mt-1 space-y-0.5 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1.5 font-mono text-[10px] leading-relaxed">
                {presentation.details.map((detail, index) => (
                    <div key={`${index}:${detail}`}>
                        {index + 1}. {detail}
                    </div>
                ))}
            </div>
        </details>
    )
}
