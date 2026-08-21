import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { Spinner } from '@/components/Spinner'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

type PdfPreviewProps = {
    bytes: Uint8Array<ArrayBuffer>
    fileName: string
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25
const MAX_PAGE_WIDTH = 900

function PreviousIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function NextIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function MinusIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <path d="M5 12h14" strokeLinecap="round" />
        </svg>
    )
}

function PlusIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
    )
}

function PdfStatus(props: { label: string }) {
    return (
        <div className="flex min-h-[420px] items-center justify-center gap-2 p-4 text-sm text-[var(--app-hint)]">
            <Spinner size="sm" label={props.label} />
            <span>{props.label}</span>
        </div>
    )
}

function PdfError(props: { message: string }) {
    return (
        <div className="flex min-h-[420px] items-center justify-center break-words p-4 text-center text-sm text-[var(--app-hint)]">
            {props.message}
        </div>
    )
}

export default function PdfPreview(props: PdfPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [pageCount, setPageCount] = useState(0)
    const [pageNumber, setPageNumber] = useState(1)
    const [zoom, setZoom] = useState(1)
    const file = useMemo(() => ({ data: props.bytes }), [props.bytes])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const updateWidth = () => setContainerWidth(container.getBoundingClientRect().width)
        updateWidth()
        const observer = new ResizeObserver(updateWidth)
        observer.observe(container)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        setPageCount(0)
        setPageNumber(1)
        setZoom(1)
    }, [props.bytes])

    const pageWidth = Math.max(240, Math.min(MAX_PAGE_WIDTH, containerWidth - 24 || MAX_PAGE_WIDTH)) * zoom
    const controlClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--app-hint)] transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-default disabled:opacity-35'

    return (
        <div ref={containerRef} className="overflow-hidden">
            <div className="flex h-11 items-center justify-between gap-2 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)] px-2">
                <div className="flex min-w-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                        disabled={pageNumber <= 1}
                        aria-label="Previous page"
                        title="Previous page"
                        className={controlClass}
                    >
                        <PreviousIcon />
                    </button>
                    <span className="min-w-16 text-center text-xs tabular-nums text-[var(--app-hint)]">
                        {pageCount ? `${pageNumber} / ${pageCount}` : '-- / --'}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                        disabled={!pageCount || pageNumber >= pageCount}
                        aria-label="Next page"
                        title="Next page"
                        className={controlClass}
                    >
                        <NextIcon />
                    </button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
                        disabled={zoom <= MIN_ZOOM}
                        aria-label="Zoom out"
                        title="Zoom out"
                        className={controlClass}
                    >
                        <MinusIcon />
                    </button>
                    <span className="min-w-11 text-center text-xs tabular-nums text-[var(--app-hint)]">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        type="button"
                        onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
                        disabled={zoom >= MAX_ZOOM}
                        aria-label="Zoom in"
                        title="Zoom in"
                        className={controlClass}
                    >
                        <PlusIcon />
                    </button>
                </div>
            </div>
            <div className="max-h-[70vh] min-h-[420px] overflow-auto bg-[#525659] p-3">
                <Document
                    file={file}
                    loading={<PdfStatus label="Loading PDF preview" />}
                    error={<PdfError message="Unable to preview this PDF file." />}
                    onLoadSuccess={({ numPages }) => {
                        setPageCount(numPages)
                        setPageNumber((current) => Math.min(Math.max(1, current), numPages))
                    }}
                    onLoadError={(error) => {
                        console.debug('Failed to load PDF preview:', error)
                    }}
                >
                    <div className="flex min-w-max justify-center">
                        <Page
                            pageNumber={pageNumber}
                            width={pageWidth}
                            loading={<PdfStatus label={`Loading page ${pageNumber}`} />}
                            renderAnnotationLayer={false}
                            renderTextLayer
                            className="shadow-md"
                            aria-label={`${props.fileName} page ${pageNumber}`}
                        />
                    </div>
                </Document>
            </div>
        </div>
    )
}
