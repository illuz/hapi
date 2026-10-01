import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { AgentReasoningBlock } from '@/chat/types'
import type { WorkGroupBlock } from '@/chat/workGroups'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { WorkGroupCard } from '@/components/ToolCard/WorkGroupCard'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, string | number>) => {
            const labels: Record<string, string> = {
                'workGroup.title': 'Worked',
                'workGroup.working': 'Working',
                'workGroup.reasoning': `${params?.n ?? 0} reasoning`,
                'workGroup.tools': `${params?.n ?? 0} tools`,
                'workGroup.loadingOlderHistory': 'Loading older work…',
                'workGroup.historyUnavailable': 'Older work is unavailable'
            }
            return labels[key] ?? key
        }
    })
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>
}))

vi.mock('@/components/AssistantChat/messages/MessageActions', () => ({
    MessageActions: () => null
}))

vi.mock('@/components/CliOutputBlock', () => ({
    CliOutputBlock: (props: { text: string }) => <div>{props.text}</div>
}))

vi.mock('@/components/AssistantChat/messages/CodexReviewCard', () => ({
    CodexReviewCard: () => <div>review</div>
}))

vi.mock('@/components/AssistantChat/messages/EventPresentationView', () => ({
    EventPresentationView: () => <div>event</div>
}))

vi.mock('@/components/ToolCard/ToolGroupCard', () => ({
    ToolGroupCard: () => <div>tool group</div>
}))

vi.mock('@/components/ToolCard/ToolCard', () => ({
    ToolCard: () => <div>tool</div>,
    ToolStatusIcon: () => <span>status</span>
}))

const contextValue = {
    api: {} as ApiClient,
    sessionId: 'work-group-card-test-session',
    metadata: null,
    terminalToolDisplayMode: 'compact' as const,
    disabled: false,
    onRefresh: vi.fn()
}

let groupSequence = 0

function makeReasoningBlock(id: string): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        id,
        localId: null,
        createdAt: 1,
        text: 'inspect repository'
    }
}

function makeReasoningBlockWithText(id: string, text: string): AgentReasoningBlock {
    return {
        ...makeReasoningBlock(id),
        text
    }
}

function makeGroup(defaultOpen = false): WorkGroupBlock {
    groupSequence += 1
    return {
        kind: 'work-group',
        id: `work-group-card-test-${groupSequence}`,
        stateKey: `after:answer-${groupSequence}`,
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        blocks: [makeReasoningBlock(`reasoning-${groupSequence}`)],
        active: false,
        defaultOpen,
        historyState: 'complete',
        needsOlderHistory: false,
        summary: {
            reasoningCount: 1,
            reviewCount: 0,
            eventCount: 0,
            toolGroupCount: 0,
            toolCount: 0,
            errorCount: 0,
            runningCount: 0,
            pendingCount: 0
        }
    }
}

function renderCard(group: WorkGroupBlock) {
    return render(
        <HappyChatProvider value={contextValue}>
            <WorkGroupCard block={group} metadata={null} />
        </HappyChatProvider>
    )
}

describe('WorkGroupCard', () => {
    afterEach(() => cleanup())

    it('renders execution details only after expanding the work group', () => {
        const group = makeGroup()
        renderCard(group)

        const toggle = screen.getByRole('button', { expanded: false })
        expect(screen.queryByText('inspect repository')).not.toBeInTheDocument()

        fireEvent.click(toggle)

        expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
        expect(screen.getByText('inspect repository')).toBeInTheDocument()
    })

    it('keeps a long execution list from shrinking its children to zero height', () => {
        const baseGroup = makeGroup(true)
        const group = {
            ...baseGroup,
            blocks: Array.from({ length: 24 }, (_, index) => makeReasoningBlock(`reasoning-long-${index}`)),
            summary: { ...baseGroup.summary, reasoningCount: 24 }
        }

        renderCard(group)

        const children = [...document.querySelectorAll('[data-work-group-child="true"]')]
        expect(children).toHaveLength(24)
        expect(children.every((child) => child.classList.contains('shrink-0'))).toBe(true)
    })

    it('keeps a manual expansion across data refresh and remount', () => {
        const group = makeGroup()
        const view = renderCard(group)
        fireEvent.click(screen.getByRole('button', { expanded: false }))

        // 补齐更早消息时，工作组首块和自身 id 都可能变化，但末块仍是同一轮的锚点。
        const hydratedGroup: WorkGroupBlock = {
            ...group,
            id: `${group.id}-hydrated`,
            blocks: [
                makeReasoningBlockWithText('older-reasoning', 'older execution'),
                group.blocks[0]!
            ],
            summary: { ...group.summary, reasoningCount: 2 }
        }
        view.rerender(
            <HappyChatProvider value={contextValue}>
                <WorkGroupCard block={{ ...hydratedGroup, defaultOpen: false }} metadata={null} />
            </HappyChatProvider>
        )
        expect(screen.getByText('inspect repository')).toBeInTheDocument()
        expect(screen.getByText('older execution')).toBeInTheDocument()

        view.unmount()
        renderCard({ ...hydratedGroup, defaultOpen: false })
        expect(screen.getByText('inspect repository')).toBeInTheDocument()
    })

    it('does not report unavailable history when the transcript simply ends', async () => {
        const loadOlderMessagesPreservingScroll = vi.fn().mockResolvedValue('terminal-stop')
        const group = { ...makeGroup(false), needsOlderHistory: true, historyState: 'needs-older-history' as const }

        render(
            <HappyChatProvider value={{
                ...contextValue,
                sessionId: 'work-group-card-terminal-stop-session',
                hasMoreMessages: true,
                loadOlderMessagesPreservingScroll
            }}>
                <WorkGroupCard block={group} metadata={null} />
            </HappyChatProvider>
        )

        fireEvent.click(screen.getByRole('button', { expanded: false }))
        await waitFor(() => expect(loadOlderMessagesPreservingScroll).toHaveBeenCalled())
        expect(screen.queryByText('Older work is unavailable')).not.toBeInTheDocument()
    })

    it('loads only one older page when an old work group is expanded', async () => {
        const loadOlderMessagesPreservingScroll = vi.fn().mockResolvedValue('loaded')
        const group = {
            ...makeGroup(false),
            stateKey: 'after:stable-answer',
            needsOlderHistory: true,
            historyState: 'needs-older-history' as const
        }

        const view = render(
            <HappyChatProvider value={{
                ...contextValue,
                sessionId: 'work-group-card-loaded-session',
                hasMoreMessages: true,
                loadOlderMessagesPreservingScroll
            }}>
                <WorkGroupCard block={group} metadata={null} />
            </HappyChatProvider>
        )

        fireEvent.click(screen.getByRole('button', { expanded: false }))
        await waitFor(() => expect(loadOlderMessagesPreservingScroll).toHaveBeenCalledTimes(1))

        // 前插历史会按数组下标重新挂载卡片；同一会话不能因此再次自动补页。
        view.unmount()
        render(
            <HappyChatProvider value={{
                ...contextValue,
                sessionId: 'work-group-card-loaded-session',
                hasMoreMessages: true,
                loadOlderMessagesPreservingScroll
            }}>
                <WorkGroupCard block={group} metadata={null} />
            </HappyChatProvider>
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(loadOlderMessagesPreservingScroll).toHaveBeenCalledTimes(1)
    })
})
