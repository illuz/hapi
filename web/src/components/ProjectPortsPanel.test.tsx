import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { PortMapping } from '@/types/api'
import { ProjectPortsPanel } from './ProjectPortsPanel'

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

function mapping(overrides: Partial<PortMapping> = {}): PortMapping {
    return {
        id: 'mapping-1',
        namespace: 'default',
        machineId: 'machine-1',
        projectPath: '/repo',
        alias: 'repo_8080',
        targetType: 'port',
        port: 8080,
        targetHost: '127.0.0.1',
        staticPath: null,
        enabled: true,
        status: 'active',
        durationMs: 30 * 60_000,
        expiresAt: Date.now() + 30 * 60_000,
        lastEnabledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
    }
}

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
    const existingPortMapping = mapping()
    const existingStaticMapping = mapping({
        id: 'mapping-2',
        alias: 'repo_dist',
        targetType: 'static',
        port: null,
        targetHost: null,
        staticPath: 'dist',
    })
    return {
        getProjectPortMappings: vi.fn(async () => ({
            mappings: [existingPortMapping, existingStaticMapping],
        })),
        createProjectPortMapping: vi.fn(async (_machineId: string, payload: unknown) => ({
            mapping: (payload as { targetType?: string })?.targetType === 'static'
                ? existingStaticMapping
                : existingPortMapping,
            accessUrl: (payload as { targetType?: string })?.targetType === 'static'
                ? 'http://localhost/ports/repo_dist/?hapi_port_token=created-static-token'
                : 'http://localhost/ports/repo_8080/?hapi_port_token=created-port-token',
        })),
        enableProjectPortMapping: vi.fn(async (mappingId: string) => ({
            mapping: mappingId === 'mapping-2' ? existingStaticMapping : existingPortMapping,
            accessUrl: mappingId === 'mapping-2'
                ? 'http://localhost/ports/repo_dist/?hapi_port_token=enabled-static-token'
                : 'http://localhost/ports/repo_8080/?hapi_port_token=enabled-port-token',
        })),
        disableProjectPortMapping: vi.fn(async () => ({ mapping: existingPortMapping })),
        deleteProjectPortMapping: vi.fn(async () => ({ mapping: existingPortMapping })),
        checkProjectPortMapping: vi.fn(async () => ({ success: true })),
        ...overrides,
    } as unknown as ApiClient
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('ProjectPortsPanel', () => {
    it('copies an existing port mapping link by enabling a fresh token when needed', async () => {
        const writeText = vi.fn(async () => undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })
        const api = createApi()

        render(
            <ProjectPortsPanel api={api} machineId="machine-1" projectPath="/repo" />,
            { wrapper: createWrapper() }
        )

        expect(await screen.findByText('/repo_8080/')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /复制链接/ }))

        await waitFor(() => {
            expect(api.enableProjectPortMapping).toHaveBeenCalledWith('mapping-1', 30 * 60_000)
            expect(writeText).toHaveBeenCalledWith('http://localhost/ports/repo_8080/?hapi_port_token=enabled-port-token')
        })
        expect(await screen.findByText('访问链接已复制。')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /复制最新链接/ })).toBeInTheDocument()
    })

    it('switches to the static tab and creates a static mapping', async () => {
        const writeText = vi.fn(async () => undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })
        const api = createApi()

        render(
            <ProjectPortsPanel api={api} machineId="machine-1" projectPath="/repo" />,
            { wrapper: createWrapper() }
        )

        fireEvent.click(screen.getByRole('button', { name: '静态文件' }))
        expect(await screen.findByText('/repo_dist/')).toBeInTheDocument()

        fireEvent.change(screen.getByPlaceholderText('dist'), { target: { value: 'build' } })
        fireEvent.click(screen.getByRole('button', { name: '创建映射' }))

        await waitFor(() => {
            expect(api.createProjectPortMapping).toHaveBeenCalledWith('machine-1', expect.objectContaining({
                targetType: 'static',
                projectPath: '/repo',
                staticPath: 'build',
                alias: 'repo_build',
            }))
        })

        expect(await screen.findByText(/静态文件映射已创建/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /复制最新链接/ }))
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('http://localhost/ports/repo_dist/?hapi_port_token=created-static-token')
        })
    })
})
