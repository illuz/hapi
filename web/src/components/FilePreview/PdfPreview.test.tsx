import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PdfPreview from './PdfPreview'

vi.mock('react-pdf', async () => {
    const React = await import('react')

    return {
        pdfjs: {
            GlobalWorkerOptions: { workerSrc: '' },
        },
        Document: (props: {
            children: React.ReactNode
            onLoadSuccess: (result: { numPages: number }) => void
        }) => {
            const loaded = React.useRef(false)
            React.useEffect(() => {
                if (loaded.current) return
                loaded.current = true
                const timeout = window.setTimeout(() => props.onLoadSuccess({ numPages: 3 }), 0)
                return () => window.clearTimeout(timeout)
            }, [props])
            return <div>{props.children}</div>
        },
        Page: (props: { pageNumber: number; width: number; 'aria-label'?: string }) => (
            <div
                data-testid="pdf-page"
                data-page={props.pageNumber}
                data-width={props.width}
                aria-label={props['aria-label']}
            />
        ),
    }
})

vi.mock('@/components/Spinner', () => ({
    Spinner: (props: { label?: string | null }) => (
        <span role={props.label === null ? undefined : 'status'} aria-label={props.label ?? undefined} />
    ),
}))

const FILE_BYTES = Uint8Array.from([1, 2, 3, 4])

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        readonly callback: ResizeObserverCallback

        constructor(callback: ResizeObserverCallback) {
            this.callback = callback
        }

        observe() {
            this.callback([], this as unknown as ResizeObserver)
        }

        disconnect() {}
        unobserve() {}
    })
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('PdfPreview', () => {
    it('supports page navigation and zoom controls', async () => {
        render(<PdfPreview bytes={FILE_BYTES} fileName="report.pdf" />)

        await waitFor(() => {
            expect(screen.getByText('1 / 3')).toBeInTheDocument()
        })
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '1')
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-width', '240')

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2')

        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
        expect(screen.getByText('125%')).toBeInTheDocument()
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-width', '300')

        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '1')
    })
})
