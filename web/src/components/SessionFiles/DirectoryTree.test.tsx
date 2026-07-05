import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DirectoryTree } from './DirectoryTree'
import type { DirectoryEntry } from '@/types/api'

const mockEntriesByPath = vi.hoisted(() => new Map<string, DirectoryEntry[]>())

vi.mock('@/hooks/queries/useSessionDirectory', () => ({
    useSessionDirectory: (_api: unknown, _sessionId: string, path: string) => ({
        entries: mockEntriesByPath.get(path) ?? [],
        error: null,
        isLoading: false,
        refetch: vi.fn(),
    })
}))

afterEach(() => {
    cleanup()
})

function renderTree(sessionId = 'session-1') {
    return render(
        <DirectoryTree
            api={null}
            sessionId={sessionId}
            rootLabel="project"
            onOpenFile={vi.fn()}
        />
    )
}

describe('DirectoryTree', () => {
    beforeEach(() => {
        window.sessionStorage.clear()
        mockEntriesByPath.clear()
        mockEntriesByPath.set('', [
            { name: 'src', type: 'directory' },
            { name: 'README.md', type: 'file' },
        ])
        mockEntriesByPath.set('src', [
            { name: 'app.ts', type: 'file' },
        ])
    })

    it('restores expanded folders after the tree unmounts and remounts', () => {
        const firstRender = renderTree()

        expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'app.ts' })).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'src' }))

        expect(screen.getByRole('button', { name: 'app.ts' })).toBeInTheDocument()

        firstRender.unmount()
        renderTree()

        expect(screen.getByRole('button', { name: 'app.ts' })).toBeInTheDocument()
    })

    it('keeps expanded folders scoped to each session', () => {
        const firstRender = renderTree('session-1')

        fireEvent.click(screen.getByRole('button', { name: 'src' }))
        expect(screen.getByRole('button', { name: 'app.ts' })).toBeInTheDocument()

        firstRender.unmount()
        renderTree('session-2')

        expect(screen.queryByRole('button', { name: 'app.ts' })).not.toBeInTheDocument()
    })
})
