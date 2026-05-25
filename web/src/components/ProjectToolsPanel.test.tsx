import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { ProjectToolsPanel } from './ProjectToolsPanel'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
}

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
        getProjectTools: vi.fn(async (_machineId: string, _projectPath: string, kind: 'agent' | 'cron') => ({
            success: true,
            kind,
            projectPath: '/repo',
            items: kind === 'agent'
                ? [{
                    kind: 'agent',
                    id: 'reviewer',
                    path: '.hapi/agents/reviewer.json',
                    hash: 'hash-agent',
                    config: {
                        id: 'reviewer',
                        name: 'Reviewer',
                        prompt: 'Review the diff',
                        agent: 'codex',
                        permissionMode: 'default',
                        enabled: true,
                    },
                }]
                : [{
                    kind: 'cron',
                    id: 'daily',
                    path: '.hapi/cron/daily.json',
                    hash: 'hash-cron',
                    config: {
                        id: 'daily',
                        name: 'Daily audit',
                        prompt: 'Run audit',
                        agent: 'claude',
                        permissionMode: 'yolo',
                        enabled: true,
                        schedule: { type: 'daily', time: '09:00' },
                    },
                }]
        })),
        getCronRuns: vi.fn(async () => ({
            runs: [{
                id: 'run-1',
                machineId: 'machine-1',
                projectPath: '/repo',
                cronId: 'daily',
                sessionId: 'session-1',
                status: 'completed',
                scheduledAt: 1,
                queuedAt: 1,
                startedAt: 2,
                finishedAt: 3,
                error: null,
                createdAt: 1,
                updatedAt: 3,
            }]
        })),
        upsertProjectTool: vi.fn(async () => ({ success: true, kind: 'agent', projectPath: '/repo', id: 'new-agent' })),
        deleteProjectTool: vi.fn(async () => ({ success: true, kind: 'agent', projectPath: '/repo', id: 'reviewer' })),
        startProjectAgent: vi.fn(async () => ({ type: 'success', sessionId: 'session-agent' })),
        runProjectCron: vi.fn(async () => ({ type: 'success', cronRunId: 'run-2', sessionId: 'session-cron' })),
        ...overrides,
    } as unknown as ApiClient
}

function renderPanel(api: ApiClient, initialTab: string = 'agents', onOpenSession = vi.fn()) {
    render(
        <ProjectToolsPanel
            api={api}
            machineId="machine-1"
            projectPath="/repo"
            initialTab={initialTab}
            onOpenSession={onOpenSession}
        />,
        { wrapper: createWrapper() }
    )
    return { onOpenSession }
}

describe('ProjectToolsPanel', () => {
    afterEach(() => {
        cleanup()
    })

    it('renders Agents, Cron, and Runs sections', async () => {
        const api = createApi()
        renderPanel(api)

        expect(await screen.findByRole('button', { name: /Agents/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Cron/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Runs' })).toBeInTheDocument()
        expect(await screen.findByText('Reviewer')).toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Describe what this tool should do…')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Cron/ }))
        expect(await screen.findByText('Daily audit')).toBeInTheDocument()
        expect(screen.getByText(/elevated permissions/i)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
        expect(await screen.findByText('Cron Runs')).toBeInTheDocument()
        expect(screen.getByText('completed')).toBeInTheDocument()
    })

    it('starts a project agent and opens the new session', async () => {
        const api = createApi()
        const onOpenSession = vi.fn()
        renderPanel(api, 'agents', onOpenSession)

        fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

        await waitFor(() => {
            expect(api.startProjectAgent).toHaveBeenCalledWith('machine-1', '/repo', 'reviewer')
            expect(onOpenSession).toHaveBeenCalledWith('session-agent')
        })
    })

    it('saves agent form changes', async () => {
        const api = createApi()
        renderPanel(api)

        fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
        expect(screen.getByText('New Agent')).toBeInTheDocument()
        fireEvent.change(screen.getByPlaceholderText('reviewer'), { target: { value: 'helper' } })
        fireEvent.change(screen.getByPlaceholderText('Code reviewer'), { target: { value: 'Helper' } })
        fireEvent.change(screen.getByPlaceholderText('Describe what this tool should do…'), { target: { value: 'Help with tasks' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }))

        await waitFor(() => {
            expect(api.upsertProjectTool).toHaveBeenCalledWith(
                'machine-1',
                'agent',
                '/repo',
                expect.objectContaining({ id: 'helper', name: 'Helper', prompt: 'Help with tasks' }),
                null
            )
        })
    })
})
