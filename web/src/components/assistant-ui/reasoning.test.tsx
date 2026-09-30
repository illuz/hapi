import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReasoningGroup } from './reasoning'

const state = vi.hoisted(() => ({
    collapsed: true,
    message: {
        status: { type: 'running' },
        content: [{ type: 'reasoning', text: 'partial' }]
    }
}))

vi.mock('@assistant-ui/react', () => ({ useMessage: () => state.message }))
vi.mock('@/hooks/useReasoningCollapse', () => ({
    useReasoningCollapse: () => ({ reasoningCollapsed: state.collapsed })
}))

describe('ReasoningGroup', () => {
    afterEach(() => cleanup())

    beforeEach(() => {
        state.collapsed = true
        state.message.status.type = 'running'
    })

    it('does not mount collapsed content during streaming updates', () => {
        const renderBody = vi.fn()
        function Body(props: { text: string }) {
            renderBody()
            return <div>{props.text}</div>
        }
        const view = render(<ReasoningGroup><Body text="partial" /></ReasoningGroup>)
        for (let tick = 0; tick < 10; tick += 1) {
            view.rerender(<ReasoningGroup><Body text={`partial ${tick}`} /></ReasoningGroup>)
        }

        expect(renderBody).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Reasoning' }))
        expect(screen.getByText('partial 9')).toBeInTheDocument()
        expect(renderBody).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: 'Reasoning' }))
        expect(screen.queryByText('partial 9')).not.toBeInTheDocument()
    })

    it('keeps a user-opened panel open as snapshots change', () => {
        const view = render(<ReasoningGroup><div>first</div></ReasoningGroup>)
        const button = screen.getByRole('button', { name: 'Reasoning' })
        expect(button).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(button)
        view.rerender(<ReasoningGroup><div>latest</div></ReasoningGroup>)

        expect(button).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('latest')).toBeVisible()
    })

    it('honors the expand-while-streaming preference', () => {
        state.collapsed = false
        render(<ReasoningGroup><div>live thought</div></ReasoningGroup>)

        expect(screen.getByRole('button', { name: 'Reasoning' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('live thought')).toBeVisible()
    })
})
