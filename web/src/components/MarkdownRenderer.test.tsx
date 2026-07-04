import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer', () => {
    it('renders outside assistant thread message context', () => {
        render(<MarkdownRenderer content={'# Preview\n\nOpen [notes](./notes.md).'} />)

        expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'notes' })).toHaveAttribute('href', './notes.md')
    })
})
