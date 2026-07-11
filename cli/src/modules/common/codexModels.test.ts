import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    connect: vi.fn(async () => {}),
    initialize: vi.fn(async () => ({})),
    listModels: vi.fn(),
    disconnect: vi.fn(async () => {})
}));

const MockCodexAppServerClient = vi.hoisted(() => vi.fn(function MockCodexAppServerClient() {
    return {
        connect: harness.connect,
        initialize: harness.initialize,
        listModels: harness.listModels,
        disconnect: harness.disconnect
    };
}));

vi.mock('@/codex/codexAppServerClient', () => ({
    CodexAppServerClient: MockCodexAppServerClient
}));

vi.mock('@/codex/utils/appServerClientInfo', () => ({
    getNonOriginatingCodexClientInfo: vi.fn(() => ({
        name: 'hapi-test',
        version: '1.0.0'
    }))
}));

import { listCodexModels } from './codexModels';

describe('listCodexModels', () => {
    beforeEach(() => {
        harness.connect.mockClear();
        harness.initialize.mockClear();
        harness.listModels.mockClear();
        harness.disconnect.mockClear();
        harness.listModels.mockResolvedValue({
            data: [
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        });
    });

    it('filters removed GPT models and adds missing known Codex models', async () => {
        harness.listModels.mockResolvedValue({
            data: [
                { id: 'gpt-5.2', displayName: 'GPT-5.2', isDefault: false },
                { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', isDefault: false },
                { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }
            ]
        });

        const models = await listCodexModels();

        expect(models).toEqual([
            expect.objectContaining({ id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true }),
            expect.objectContaining({ id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', isDefault: false }),
            expect.objectContaining({ id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: false }),
            expect.objectContaining({ id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', isDefault: false })
        ]);
    });
});
