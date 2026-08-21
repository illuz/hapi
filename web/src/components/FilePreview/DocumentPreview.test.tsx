import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'

const previewMocks = vi.hoisted(() => ({
    readExcelFile: vi.fn(),
    renderWord: vi.fn(),
}))

vi.mock('docx-preview', () => ({
    renderAsync: previewMocks.renderWord,
}))

vi.mock('read-excel-file/browser', () => ({
    default: previewMocks.readExcelFile,
}))

vi.mock('./PdfPreview', () => ({
    default: (props: { fileName: string }) => (
        <div data-testid="pdf-preview-renderer">{props.fileName}</div>
    ),
}))

vi.mock('@/components/Spinner', () => ({
    Spinner: (props: { label?: string | null }) => (
        <span role={props.label === null ? undefined : 'status'} aria-label={props.label ?? undefined} />
    ),
}))

const FILE_BYTES = Uint8Array.from([1, 2, 3, 4])

beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn(() => 'blob:hapi-document-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: vi.fn(),
    })
    previewMocks.renderWord.mockImplementation(async (_data: Blob, container: HTMLElement) => {
        const paragraph = document.createElement('p')
        paragraph.textContent = 'Quarterly proposal'
        container.appendChild(paragraph)
    })
    previewMocks.readExcelFile.mockResolvedValue([
        {
            sheet: 'Summary',
            data: [
                ['Name', 'Amount'],
                ['Revenue', 42],
            ],
        },
        {
            sheet: 'Notes',
            data: [
                ['Status'],
                ['Final'],
            ],
        },
    ])
})

afterEach(() => {
    cleanup()
})

describe('DocumentPreview', () => {
    it('loads the PDF renderer inside the preview surface', async () => {
        render(<DocumentPreview bytes={FILE_BYTES} fileName="report.pdf" kind="pdf" />)

        expect(await screen.findByTestId('pdf-preview-renderer')).toHaveTextContent('report.pdf')
        expect(screen.getByRole('region', { name: 'report.pdf preview' })).toBeInTheDocument()
    })

    it('renders DOCX content into the preview surface', async () => {
        render(<DocumentPreview bytes={FILE_BYTES} fileName="proposal.docx" kind="word" />)

        expect(await screen.findByText('Quarterly proposal')).toBeInTheDocument()
        expect(previewMocks.renderWord).toHaveBeenCalledOnce()
        expect(previewMocks.renderWord.mock.calls[0]?.[3]).toMatchObject({ renderAltChunks: false })
    })

    it('removes active content and unsafe links from rendered DOCX files', async () => {
        previewMocks.renderWord.mockImplementationOnce(async (_data: Blob, container: HTMLElement) => {
            const link = document.createElement('a')
            link.href = 'javascript:alert(1)'
            link.textContent = 'Unsafe link'
            container.append(link, document.createElement('iframe'))
        })

        render(<DocumentPreview bytes={FILE_BYTES} fileName="unsafe.docx" kind="word" />)

        const link = await screen.findByText('Unsafe link')
        expect(link).not.toHaveAttribute('href')
        expect(document.querySelector('iframe')).not.toBeInTheDocument()
    })

    it('renders workbook cells and switches worksheets', async () => {
        render(<DocumentPreview bytes={FILE_BYTES} fileName="budget.xlsx" kind="spreadsheet" />)

        expect(await screen.findByText('Revenue')).toBeInTheDocument()
        expect(screen.getByText('42')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

        expect(screen.getByText('Final')).toBeInTheDocument()
        expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
    })

    it('shows a useful error when workbook parsing fails', async () => {
        previewMocks.readExcelFile.mockRejectedValueOnce(new Error('Invalid workbook'))

        render(<DocumentPreview bytes={FILE_BYTES} fileName="broken.xlsx" kind="spreadsheet" />)

        expect(await screen.findByText('Unable to preview this Excel workbook: Invalid workbook')).toBeInTheDocument()
    })
})
