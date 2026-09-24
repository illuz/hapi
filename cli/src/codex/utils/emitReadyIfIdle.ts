export type ReadyEventOptions = {
    pending: unknown;
    queueSize: () => number;
    shouldExit: boolean;
    inFlight: boolean;
    sendReady: () => void;
    notify?: () => void;
};

/**
 * Notify connected clients when Codex finishes processing and the queue is idle.
 * The in-flight guard is important for delayed ready timers: a timer created
 * for a failed turn can fire after its retry has already started.
 * Returns true when a ready event was emitted.
 */
export function emitReadyIfIdle({ pending, queueSize, shouldExit, inFlight, sendReady, notify }: ReadyEventOptions): boolean {
    if (shouldExit) {
        return false;
    }
    if (inFlight) {
        return false;
    }
    if (pending) {
        return false;
    }
    if (queueSize() > 0) {
        return false;
    }

    sendReady();
    notify?.();
    return true;
}
