import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isPageVisible, subscribePageVisibility } from '@/lib/pageVisibility'
import { randomId } from '@/lib/randomId'

export type Toast = {
    id: string
    title: string
    body: string
    sessionId: string
    url: string
    kind?: 'permission-request' | 'ready' | 'message' | 'failure'
}

export type ToastContextValue = {
    toasts: Toast[]
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
export const TOAST_DURATION_MS = 15000

type ToastLifetime = {
    started: boolean
}

function createToastId(): string {
    return randomId()
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const lifetimesRef = useRef<Map<string, ToastLifetime>>(new Map())

    const clearTimer = useCallback((id: string) => {
        const timer = timersRef.current.get(id)
        if (!timer) {
            return
        }
        clearTimeout(timer)
        timersRef.current.delete(id)
    }, [])

    useEffect(() => {
        return () => {
            for (const timer of timersRef.current.values()) {
                clearTimeout(timer)
            }
            timersRef.current.clear()
            lifetimesRef.current.clear()
        }
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
        clearTimer(id)
        lifetimesRef.current.delete(id)
    }, [clearTimer])

    const startToastTimer = useCallback((id: string, lifetime: ToastLifetime) => {
        clearTimer(id)
        lifetime.started = true
        const timer = setTimeout(() => {
            removeToast(id)
        }, TOAST_DURATION_MS)
        timersRef.current.set(id, timer)
    }, [clearTimer, removeToast])

    const syncToastTimers = useCallback(() => {
        if (!isPageVisible()) {
            return
        }

        for (const [id, lifetime] of lifetimesRef.current) {
            if (lifetime.started) {
                continue
            }
            startToastTimer(id, lifetime)
        }
    }, [startToastTimer])

    useEffect(() => {
        const unsubscribe = subscribePageVisibility(syncToastTimers)
        syncToastTimers()
        return unsubscribe
    }, [syncToastTimers])

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = createToastId()
        const lifetime: ToastLifetime = {
            started: false
        }

        lifetimesRef.current.set(id, lifetime)
        setToasts((prev) => [...prev, { id, ...toast }])
        if (isPageVisible()) {
            startToastTimer(id, lifetime)
        }
    }, [startToastTimer])

    const value = useMemo<ToastContextValue>(() => ({
        toasts,
        addToast,
        removeToast
    }), [toasts, addToast, removeToast])

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return ctx
}
