import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AssistantFollowupProvider } from './AssistantFollowupProvider'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

const composer = vi.hoisted(() => ({
    getState: vi.fn(() => ({ text: '' })),
    setText: vi.fn(),
    send: vi.fn(),
}))
vi.mock('@assistant-ui/react', async (importOriginal) => ({
    ...await importOriginal<typeof import('@assistant-ui/react')>(),
    useAssistantApi: () => ({ composer: () => composer }),
}))

afterEach(cleanup)

describe('AssistantFollowupProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        composer.getState.mockReturnValue({ text: '' })
    })

    function show(disabled = false) {
        render(
            <AssistantFollowupProvider disabled={disabled}>
                <MarkdownRenderer content={':codex-followup[合并]{prompt="合并为 CSV"}'} />
            </AssistantFollowupProvider>
        )
    }

    it('fills an empty composer without automatically sending', () => {
        show()
        expect(composer.setText).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: '合并' }))
        expect(composer.setText).toHaveBeenCalledWith('合并为 CSV')
        expect(composer.send).not.toHaveBeenCalled()
    })

    it('preserves the latest draft rather than overwriting it', () => {
        show()
        composer.getState.mockReturnValue({ text: '尚未发送的草稿' })
        fireEvent.click(screen.getByRole('button', { name: '合并' }))
        expect(composer.setText).toHaveBeenCalledWith('尚未发送的草稿\n\n合并为 CSV')
        expect(composer.send).not.toHaveBeenCalled()
    })

    it('disables insertion for inactive sessions', () => {
        show(true)
        fireEvent.click(screen.getByRole('button', { name: '合并' }))
        expect(composer.setText).not.toHaveBeenCalled()
        expect(composer.send).not.toHaveBeenCalled()
    })
})
