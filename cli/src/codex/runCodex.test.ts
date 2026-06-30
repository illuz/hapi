import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCodexSession = vi.hoisted(() => ({
    setModel: vi.fn(),
    setModelReasoningEffort: vi.fn(),
    setPermissionMode: vi.fn(),
    setServiceTier: vi.fn(),
    setCollaborationMode: vi.fn(),
    pushKeepAlive: vi.fn(),
    thinking: false,
    stopKeepAlive: vi.fn()
}));

const harness = vi.hoisted(() => ({
    bootstrapArgs: [] as Array<Record<string, unknown>>,
    loopArgs: [] as Array<Record<string, unknown>>,
    loopError: null as Error | null,
    session: {
        onUserMessage: vi.fn(),
        onCancelQueuedMessage: vi.fn(),
        rpcHandlerManager: {
            registerHandler: vi.fn()
        }
    }
}));

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: vi.fn(async (options: Record<string, unknown>) => {
        harness.bootstrapArgs.push(options);
        return {
            api: {},
            session: harness.session
        };
    })
}));

vi.mock('./loop', () => ({
    loop: vi.fn(async (options: Record<string, unknown>) => {
        harness.loopArgs.push(options);
        if (harness.loopError) {
            throw harness.loopError;
        }
        const onSessionReady = options.onSessionReady as ((session: unknown) => void) | undefined;
        onSessionReady?.(mockCodexSession);
    })
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: vi.fn()
}));

const lifecycleMock = vi.hoisted(() => ({
    registerProcessHandlers: vi.fn(),
    cleanupAndExit: vi.fn(async () => {}),
    markCrash: vi.fn(),
    setExitCode: vi.fn(),
    setArchiveReason: vi.fn(),
    setSessionEndReason: vi.fn()
}));

vi.mock('@/agent/runnerLifecycle', () => ({
    createModeChangeHandler: vi.fn(() => vi.fn()),
    createRunnerLifecycle: vi.fn(() => lifecycleMock),
    setControlledByUser: vi.fn()
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}));

vi.mock('@/utils/attachmentFormatter', () => ({
    formatMessageWithAttachments: vi.fn((text: string) => text)
}));

vi.mock('@/utils/invokedCwd', () => ({
    getInvokedCwd: vi.fn(() => '/tmp/project')
}));

import { runCodex } from './runCodex';

describe('runCodex defaults', () => {
    beforeEach(() => {
        harness.bootstrapArgs.length = 0;
        harness.loopArgs.length = 0;
        harness.loopError = null;
        harness.session.onUserMessage.mockReset();
        harness.session.onCancelQueuedMessage.mockReset();
        harness.session.rpcHandlerManager.registerHandler.mockReset();
        mockCodexSession.setModel.mockReset();
        mockCodexSession.setModelReasoningEffort.mockReset();
        mockCodexSession.setPermissionMode.mockReset();
        mockCodexSession.setServiceTier.mockReset();
        mockCodexSession.setCollaborationMode.mockReset();
        lifecycleMock.cleanupAndExit.mockClear();
        lifecycleMock.setSessionEndReason.mockClear();
    });

    it('defaults new Codex sessions to GPT-5.5 and xhigh reasoning', async () => {
        await runCodex({});

        expect(harness.bootstrapArgs[0]).toMatchObject({
            model: 'gpt-5.5',
            modelReasoningEffort: 'xhigh'
        });
        expect(harness.loopArgs[0]).toMatchObject({
            model: 'gpt-5.5',
            modelReasoningEffort: 'xhigh'
        });
        expect(mockCodexSession.setModel).toHaveBeenLastCalledWith('gpt-5.5');
        expect(mockCodexSession.setModelReasoningEffort).toHaveBeenLastCalledWith('xhigh');
    });

    it('does not inject defaults when resuming an existing Codex thread', async () => {
        await runCodex({ resumeSessionId: 'codex-thread-1' });

        expect(harness.bootstrapArgs[0]?.model).toBeUndefined();
        expect(harness.bootstrapArgs[0]?.modelReasoningEffort).toBeUndefined();
        expect(harness.loopArgs[0]?.model).toBeUndefined();
        expect(harness.loopArgs[0]?.modelReasoningEffort).toBeUndefined();
    });
});
