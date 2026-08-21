import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Spinner } from '@/components/Spinner'

const PdfPreview = lazy(() => import('./PdfPreview'))

export type DocumentPreviewKind = 'pdf' | 'word' | 'spreadsheet'

type PreviewProps = {
    bytes: Uint8Array<ArrayBuffer>
    fileName: string
}

type SpreadsheetCell = string | number | boolean | Date | null

type SpreadsheetSheet = {
    sheet: string
    data: SpreadsheetCell[][]
}

const MAX_SPREADSHEET_ROWS = 500
const MAX_SPREADSHEET_COLUMNS = 100

function getErrorMessage(error: unknown): string {
    return error instanceof Error && error.message
        ? error.message
        : 'Unknown preview error'
}

function sanitizeWordPreview(container: HTMLElement): void {
    container.querySelectorAll('iframe, script, object, embed, form').forEach((element) => element.remove())
    container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        const href = anchor.getAttribute('href') ?? ''
        if (href.startsWith('#')) return

        try {
            const url = new URL(href)
            if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
                anchor.removeAttribute('href')
                return
            }
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                anchor.target = '_blank'
                anchor.rel = 'noreferrer noopener'
            }
        } catch {
            anchor.removeAttribute('href')
        }
    })
}

function PreviewFrame(props: {
    fileName: string
    children: ReactNode
    busy?: boolean
}) {
    return (
        <section
            role="region"
            aria-label={`${props.fileName} preview`}
            aria-busy={props.busy}
            className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]"
        >
            {props.children}
        </section>
    )
}

function PreviewStatus(props: { label: string }) {
    return (
        <div className="flex min-h-[220px] items-center justify-center gap-2 bg-[var(--app-code-bg)] p-4 text-sm text-[var(--app-hint)]">
            <Spinner size="sm" label={props.label} />
            <span>{props.label}</span>
        </div>
    )
}

function PreviewError(props: { message: string }) {
    return (
        <div className="flex min-h-[220px] items-center justify-center break-words bg-[var(--app-code-bg)] p-4 text-center text-sm text-[var(--app-hint)]">
            {props.message}
        </div>
    )
}

function WordPreview(props: PreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        const container = containerRef.current
        container?.replaceChildren()
        setStatus('loading')
        setError(null)

        const render = async () => {
            const staging = document.createElement('div')
            const { renderAsync } = await import('docx-preview')
            await renderAsync(new Blob([props.bytes]), staging, staging, {
                breakPages: true,
                ignoreHeight: false,
                ignoreWidth: false,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
                renderEndnotes: true,
                renderAltChunks: false,
                useBase64URL: true,
            })

            if (cancelled || !containerRef.current) return
            sanitizeWordPreview(staging)
            containerRef.current.replaceChildren(...Array.from(staging.childNodes))
            setStatus('ready')
        }

        void render().catch((renderError: unknown) => {
            if (cancelled) return
            setError(getErrorMessage(renderError))
            setStatus('error')
        })

        return () => {
            cancelled = true
            container?.replaceChildren()
        }
    }, [props.bytes])

    return (
        <PreviewFrame fileName={props.fileName} busy={status === 'loading'}>
            {status === 'loading' ? <PreviewStatus label="Loading Word preview" /> : null}
            {status === 'error' ? (
                <PreviewError message={`Unable to preview this Word document: ${error}`} />
            ) : null}
            <div
                ref={containerRef}
                className={status === 'ready'
                    ? 'max-h-[70vh] overflow-auto bg-[#e5e7eb] p-3 [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0'
                    : 'hidden'}
            />
        </PreviewFrame>
    )
}

function getColumnLabel(index: number): string {
    let value = index + 1
    let label = ''
    while (value > 0) {
        const remainder = (value - 1) % 26
        label = String.fromCharCode(65 + remainder) + label
        value = Math.floor((value - 1) / 26)
    }
    return label
}

function formatSpreadsheetCell(value: SpreadsheetCell | undefined): string {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return value.toLocaleString()
    return String(value)
}

function SpreadsheetGrid(props: { sheet: SpreadsheetSheet }) {
    const visibleRows = props.sheet.data.slice(0, MAX_SPREADSHEET_ROWS)
    const sourceColumnCount = visibleRows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
    const columnCount = Math.min(sourceColumnCount, MAX_SPREADSHEET_COLUMNS)
    const truncated = props.sheet.data.length > MAX_SPREADSHEET_ROWS
        || sourceColumnCount > MAX_SPREADSHEET_COLUMNS

    if (visibleRows.length === 0 || columnCount === 0) {
        return <PreviewError message="This worksheet is empty." />
    }

    return (
        <>
            <div className="max-h-[70vh] overflow-auto bg-white">
                <table className="min-w-full border-separate border-spacing-0 text-xs text-[#111827]" aria-label={`${props.sheet.sheet} worksheet`}>
                    <thead className="sticky top-0 z-20">
                        <tr>
                            <th className="sticky left-0 z-30 h-7 min-w-10 border-b border-r border-[#d1d5db] bg-[#f3f4f6]" />
                            {Array.from({ length: columnCount }, (_, columnIndex) => (
                                <th
                                    key={columnIndex}
                                    scope="col"
                                    className="h-7 min-w-24 border-b border-r border-[#d1d5db] bg-[#f3f4f6] px-2 text-center font-medium text-[#4b5563]"
                                >
                                    {getColumnLabel(columnIndex)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                <th
                                    scope="row"
                                    className="sticky left-0 z-10 h-7 border-b border-r border-[#d1d5db] bg-[#f3f4f6] px-2 text-right font-medium text-[#4b5563]"
                                >
                                    {rowIndex + 1}
                                </th>
                                {Array.from({ length: columnCount }, (_, columnIndex) => (
                                    <td
                                        key={columnIndex}
                                        className="h-7 max-w-80 whitespace-pre-wrap break-words border-b border-r border-[#e5e7eb] px-2 py-1 align-top"
                                    >
                                        {formatSpreadsheetCell(row[columnIndex])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {truncated ? (
                <div className="border-t border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)]">
                    Preview limited to the first {MAX_SPREADSHEET_ROWS} rows and {MAX_SPREADSHEET_COLUMNS} columns.
                </div>
            ) : null}
        </>
    )
}

function SpreadsheetPreview(props: PreviewProps) {
    const [sheets, setSheets] = useState<SpreadsheetSheet[]>([])
    const [activeSheetIndex, setActiveSheetIndex] = useState(0)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setSheets([])
        setActiveSheetIndex(0)
        setStatus('loading')
        setError(null)

        const parse = async () => {
            const { default: readExcelFile } = await import('read-excel-file/browser')
            const parsedSheets = await readExcelFile(props.bytes.slice().buffer)
            if (cancelled) return
            setSheets(parsedSheets as SpreadsheetSheet[])
            setStatus('ready')
        }

        void parse().catch((parseError: unknown) => {
            if (cancelled) return
            setError(getErrorMessage(parseError))
            setStatus('error')
        })

        return () => {
            cancelled = true
        }
    }, [props.bytes])

    const activeSheet = sheets[activeSheetIndex]

    return (
        <PreviewFrame fileName={props.fileName} busy={status === 'loading'}>
            {status === 'loading' ? <PreviewStatus label="Loading Excel preview" /> : null}
            {status === 'error' ? (
                <PreviewError message={`Unable to preview this Excel workbook: ${error}`} />
            ) : null}
            {status === 'ready' && sheets.length === 0 ? (
                <PreviewError message="This workbook has no worksheets." />
            ) : null}
            {status === 'ready' && activeSheet ? (
                <>
                    {sheets.length > 1 ? (
                        <div className="flex overflow-x-auto border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)]" role="tablist" aria-label="Worksheets">
                            {sheets.map((sheet, index) => (
                                <button
                                    key={`${sheet.sheet}-${index}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={index === activeSheetIndex}
                                    onClick={() => setActiveSheetIndex(index)}
                                    className={index === activeSheetIndex
                                        ? 'max-w-48 shrink-0 truncate border-b-2 border-[var(--app-link)] px-3 py-2 text-xs font-semibold text-[var(--app-fg)]'
                                        : 'max-w-48 shrink-0 truncate border-b-2 border-transparent px-3 py-2 text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]'}
                                    title={sheet.sheet}
                                >
                                    {sheet.sheet}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <SpreadsheetGrid sheet={activeSheet} />
                </>
            ) : null}
        </PreviewFrame>
    )
}

export default function DocumentPreview(props: PreviewProps & { kind: DocumentPreviewKind }) {
    if (props.kind === 'pdf') {
        return (
            <PreviewFrame fileName={props.fileName}>
                <Suspense fallback={<PreviewStatus label="Loading PDF preview" />}>
                    <PdfPreview bytes={props.bytes} fileName={props.fileName} />
                </Suspense>
            </PreviewFrame>
        )
    }
    if (props.kind === 'word') {
        return <WordPreview bytes={props.bytes} fileName={props.fileName} />
    }
    return <SpreadsheetPreview bytes={props.bytes} fileName={props.fileName} />
}
