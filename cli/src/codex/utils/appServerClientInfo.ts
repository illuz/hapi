import type { InitializeParams } from '../appServerTypes';

const NON_ORIGINATING_CODEX_CLIENT_NAME = 'codex-backend';

export function getNonOriginatingCodexClientInfo(): InitializeParams['clientInfo'] {
    return {
        name: NON_ORIGINATING_CODEX_CLIENT_NAME,
        version: '1.0.0'
    };
}
