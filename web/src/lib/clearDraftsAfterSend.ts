import { clearDraft } from '@/lib/composer-drafts'
import { clearComposerDraft } from '@/lib/composerDraftStorage'

/**
 * Clear draft(s) after a successful send.
 * When `resolveSessionId` swaps the session (e.g. inactive → resumed),
 * the sent ID differs from the route's session ID, so both must be cleared.
 */
export function clearDraftsAfterSend(
    sentSessionId: string,
    routeSessionId: string | null,
): void {
    clearDraft(sentSessionId)
    clearComposerDraft(sentSessionId)
    if (routeSessionId && sentSessionId !== routeSessionId) {
        clearDraft(routeSessionId)
        clearComposerDraft(routeSessionId)
    }
}
