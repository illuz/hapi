import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { SessionMarkerDot } from '@/components/SessionMarkerDot'
import { SESSION_MARKER_COLORS } from '@/lib/sessionMarkers'
import { useTranslation } from '@/lib/use-translation'
import type { SessionMarkerColor } from '@/types/api'

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

export function SessionMarkerMenu(props: {
    isOpen: boolean
    onClose: () => void
    anchorPoint: { x: number; y: number }
    markerColor: SessionMarkerColor | null
    onSelectMarkerColor: (markerColor: SessionMarkerColor | null) => void
    menuId?: string
}) {
    const { t } = useTranslation()
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
    const internalId = useId()
    const resolvedMenuId = props.menuId ?? `session-marker-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - props.anchorPoint.y
        const spaceAbove = props.anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? props.anchorPoint.y - menuRect.height - gap : props.anchorPoint.y + gap
        let left = props.anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [props.anchorPoint])

    useLayoutEffect(() => {
        if (!props.isOpen) return
        updatePosition()
    }, [props.isOpen, updatePosition])

    useEffect(() => {
        if (!props.isOpen) {
            setMenuPosition(null)
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            props.onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                props.onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [props.isOpen, props.onClose, updatePosition])

    useEffect(() => {
        if (!props.isOpen) return

        const frame = window.requestAnimationFrame(() => {
            const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
            firstItem?.focus()
        })

        return () => window.cancelAnimationFrame(frame)
    }, [props.isOpen])

    if (!props.isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.action.marker')}
            </div>
            <div
                id={resolvedMenuId}
                role="menu"
                aria-labelledby={headingId}
                className="flex flex-col gap-1"
            >
                {SESSION_MARKER_COLORS.map((markerColor) => (
                    <button
                        key={markerColor}
                        type="button"
                        role="menuitemradio"
                        aria-checked={props.markerColor === markerColor}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        onClick={() => {
                            props.onClose()
                            props.onSelectMarkerColor(markerColor)
                        }}
                    >
                        <SessionMarkerDot markerColor={markerColor} size={10} />
                        {t(`session.marker.${markerColor}`)}
                    </button>
                ))}
                <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                    onClick={() => {
                        props.onClose()
                        props.onSelectMarkerColor(null)
                    }}
                >
                    <span className="inline-block h-[10px] w-[10px] rounded-full border border-[var(--app-divider)]" aria-hidden="true" />
                    {t('session.action.clearMarker')}
                </button>
            </div>
        </div>
    )
}
