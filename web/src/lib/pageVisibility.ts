export type PageVisibilityState = 'visible' | 'hidden'

export function getPageVisibility(): PageVisibilityState {
    if (typeof document === 'undefined') {
        return 'hidden'
    }
    return document.visibilityState === 'visible' ? 'visible' : 'hidden'
}

export function isPageVisible(): boolean {
    return getPageVisibility() === 'visible'
}

export function subscribePageVisibility(listener: () => void): () => void {
    if (typeof document === 'undefined') {
        return () => {}
    }

    const handleVisibilityChange = () => {
        listener()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
}
