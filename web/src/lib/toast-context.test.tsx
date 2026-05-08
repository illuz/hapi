import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_DURATION_MS, ToastProvider, useToast } from './toast-context'

function ToastHarness() {
    const { toasts, addToast } = useToast()

    return (
        <div>
            <button
                type="button"
                onClick={() => addToast({
                    title: 'New message',
                    body: 'Body',
                    sessionId: 'session-1',
                    url: '/sessions/session-1',
                    kind: 'message'
                })}
            >
                add toast
            </button>
            <div data-testid="toast-count">{toasts.length}</div>
            {toasts.map((toast) => (
                <div key={toast.id}>{toast.title}</div>
            ))}
        </div>
    )
}

describe('ToastProvider', () => {
    let visibilityState: 'visible' | 'hidden'

    beforeEach(() => {
        vi.useFakeTimers()
        visibilityState = 'visible'
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState
        })
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
    })

    it('keeps a toast alive while the page is hidden and starts the timeout after visibility returns', () => {
        visibilityState = 'hidden'
        render(
            <ToastProvider>
                <ToastHarness />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'add toast' }))
        expect(screen.getByTestId('toast-count')).toHaveTextContent('1')

        act(() => {
            vi.advanceTimersByTime(TOAST_DURATION_MS * 2)
        })
        expect(screen.getByTestId('toast-count')).toHaveTextContent('1')

        act(() => {
            visibilityState = 'visible'
            document.dispatchEvent(new Event('visibilitychange'))
        })

        act(() => {
            vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
        })
        expect(screen.getByTestId('toast-count')).toHaveTextContent('1')

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(screen.getByTestId('toast-count')).toHaveTextContent('0')
    })

    it('continues an existing toast timeout while the page is hidden after it starts', () => {
        render(
            <ToastProvider>
                <ToastHarness />
            </ToastProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'add toast' }))
        expect(screen.getByTestId('toast-count')).toHaveTextContent('1')

        act(() => {
            vi.advanceTimersByTime(5_000)
            visibilityState = 'hidden'
            document.dispatchEvent(new Event('visibilitychange'))
            vi.advanceTimersByTime(TOAST_DURATION_MS - 5_001)
        })
        expect(screen.getByTestId('toast-count')).toHaveTextContent('1')

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(screen.getByTestId('toast-count')).toHaveTextContent('0')
    })
})
