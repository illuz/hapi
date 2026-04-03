import type { Session } from '../sync/syncEngine'
import type { NotificationChannel } from '../notifications/notificationTypes'
import { getAgentName, getSessionName } from '../notifications/sessionInfo'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { PushPayload, PushService } from './pushService'

export class PushNotificationChannel implements NotificationChannel {
    constructor(
        private readonly pushService: PushService,
        private readonly sseManager: SSEManager,
        private readonly visibilityTracker: VisibilityTracker,
        _appUrl: string
    ) {}

    async sendPermissionRequest(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const name = getSessionName(session)
        const request = session.agentState?.requests
            ? Object.values(session.agentState.requests)[0]
            : null
        const toolName = request?.tool ? ` (${request.tool})` : ''

        await this.deliverToastOrPush(session, {
            title: 'Permission Request',
            body: `${name}${toolName}`,
            tag: `permission-${session.id}`,
            kind: 'permission-request'
        })
    }

    async sendReady(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)

        await this.deliverToastOrPush(session, {
            title: 'Ready for input',
            body: `${agentName} is waiting in ${name}`,
            tag: `ready-${session.id}`,
            kind: 'ready'
        })
    }

    async sendMessage(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)

        await this.deliverToastOrPush(session, {
            title: 'New message',
            body: `${agentName} sent a message in ${name}`,
            tag: `message-${session.id}`,
            kind: 'message'
        })
    }

    async sendFailure(session: Session, message: string): Promise<void> {
        if (!session.active) {
            return
        }

        const name = getSessionName(session)
        await this.deliverToastOrPush(session, {
            title: 'Execution failed',
            body: `${name}: ${message}`,
            tag: `failure-${session.id}`,
            kind: 'failure'
        })
    }

    private async deliverToastOrPush(
        session: Session,
        args: {
            title: string
            body: string
            tag: string
            kind: 'permission-request' | 'ready' | 'message' | 'failure'
        }
    ): Promise<void> {
        const payload: PushPayload = {
            title: args.title,
            body: args.body,
            tag: args.tag,
            data: {
                type: args.kind,
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        if (this.visibilityTracker.hasVisibleConnection(session.namespace)) {
            const delivered = await this.sseManager.sendToast(session.namespace, {
                type: 'toast',
                data: {
                    title: payload.title,
                    body: payload.body,
                    sessionId: session.id,
                    url,
                    kind: args.kind
                }
            })
            if (delivered > 0) {
                return
            }
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    private buildSessionPath(sessionId: string): string {
        return `/sessions/${sessionId}`
    }
}
