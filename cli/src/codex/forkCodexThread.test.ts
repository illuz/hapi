import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    forkThread: vi.fn(async () => ({ thread: { id: 'thread-forked' } })),
    listThreadTurns: vi.fn(async (): Promise<{
        data: Array<{ id: string }>;
        nextCursor: string | null;
        backwardsCursor: string | null;
    }> => ({
        data: [
            { id: 'turn-latest' },
            { id: 'turn-selected' }
        ],
        nextCursor: null,
        backwardsCursor: null
    })),
    rollbackThread: vi.fn(async () => {
        throw new Error('paginated threads do not support thread/rollback');
    })
}));

vi.mock('@/codex/codexAppServerClient', () => ({
    CodexAppServerClient: vi.fn(function MockCodexAppServerClient() {
        return {
            connect: vi.fn(async () => {}),
            initialize: vi.fn(async () => ({})),
            forkThread: harness.forkThread,
            listThreadTurns: harness.listThreadTurns,
            rollbackThread: harness.rollbackThread,
            disconnect: vi.fn(async () => {})
        };
    })
}));

vi.mock('./utils/appServerClientInfo', () => ({
    getNonOriginatingCodexClientInfo: vi.fn(() => ({
        name: 'hapi-test',
        version: '1.0.0'
    }))
}));

import { forkCodexThread } from './forkCodexThread';

describe('forkCodexThread', () => {
    beforeEach(() => {
        harness.forkThread.mockClear();
        harness.listThreadTurns.mockClear();
        harness.rollbackThread.mockClear();
    });

    it('forks through the selected turn without rolling back paginated threads', async () => {
        await expect(forkCodexThread({
            threadId: 'thread-source',
            rollbackTurns: 1
        })).resolves.toEqual({
            success: true,
            threadId: 'thread-forked'
        });

        expect(harness.listThreadTurns).toHaveBeenCalledWith({
            threadId: 'thread-source',
            limit: 2,
            sortDirection: 'desc',
            itemsView: 'notLoaded'
        });
        expect(harness.forkThread).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-source',
            lastTurnId: 'turn-selected'
        }));
        expect(harness.rollbackThread).not.toHaveBeenCalled();
    });

    it('forks the complete thread without listing turns', async () => {
        await expect(forkCodexThread({
            threadId: 'thread-source',
            rollbackTurns: 0
        })).resolves.toEqual({
            success: true,
            threadId: 'thread-forked'
        });

        expect(harness.listThreadTurns).not.toHaveBeenCalled();
        expect(harness.forkThread).toHaveBeenCalledWith({
            threadId: 'thread-source',
            ephemeral: false,
            excludeTurns: true
        });
    });

    it('pages backward through a long thread to resolve the selected turn', async () => {
        harness.listThreadTurns
            .mockResolvedValueOnce({
                data: Array.from({ length: 100 }, (_, index) => ({ id: `turn-${index}` })),
                nextCursor: 'older-turns',
                backwardsCursor: null
            })
            .mockResolvedValueOnce({
                data: [{ id: 'turn-selected' }],
                nextCursor: null,
                backwardsCursor: null
            });

        await expect(forkCodexThread({
            threadId: 'thread-source',
            rollbackTurns: 100
        })).resolves.toEqual({
            success: true,
            threadId: 'thread-forked'
        });

        expect(harness.listThreadTurns).toHaveBeenNthCalledWith(1, {
            threadId: 'thread-source',
            limit: 100,
            sortDirection: 'desc',
            itemsView: 'notLoaded'
        });
        expect(harness.listThreadTurns).toHaveBeenNthCalledWith(2, {
            threadId: 'thread-source',
            cursor: 'older-turns',
            limit: 1,
            sortDirection: 'desc',
            itemsView: 'notLoaded'
        });
        expect(harness.forkThread).toHaveBeenCalledWith(expect.objectContaining({
            lastTurnId: 'turn-selected'
        }));
    });

    it('fails before forking when the selected turn no longer exists', async () => {
        harness.listThreadTurns.mockResolvedValueOnce({
            data: [{ id: 'turn-only' }],
            nextCursor: null,
            backwardsCursor: null
        });

        await expect(forkCodexThread({
            threadId: 'thread-source',
            rollbackTurns: 2
        })).resolves.toEqual({
            success: false,
            error: 'Codex thread has fewer than 3 turns'
        });

        expect(harness.forkThread).not.toHaveBeenCalled();
        expect(harness.rollbackThread).not.toHaveBeenCalled();
    });
});
