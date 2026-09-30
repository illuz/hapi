import { describe, expect, it } from 'vitest';
import { convertAgentMessage } from './messageConverter';

describe('convertAgentMessage', () => {
    it('keeps tool-call status when converting ACP tool events', () => {
        const converted = convertAgentMessage({
            type: 'tool_call',
            id: 'call-1',
            name: 'Bash',
            input: { cmd: 'echo test' },
            status: 'completed'
        });

        expect(converted).toEqual({
            type: 'tool-call',
            callId: 'call-1',
            name: 'Bash',
            input: { cmd: 'echo test' },
            status: 'completed'
        });
    });

    it('marks failed tool results as error', () => {
        const converted = convertAgentMessage({
            type: 'tool_result',
            id: 'call-2',
            output: { message: 'boom' },
            status: 'failed'
        });

        expect(converted).toEqual({
            type: 'tool-call-result',
            callId: 'call-2',
            output: { message: 'boom' },
            is_error: true
        });
    });

    it('preserves stable reasoning id when provided', () => {
        const converted = convertAgentMessage({
            type: 'reasoning',
            text: 'thinking',
            id: 'reasoning-stream-1'
        });

        expect(converted).toEqual({
            type: 'reasoning',
            message: 'thinking',
            id: 'reasoning-stream-1'
        });
    });

    it('marks live reasoning snapshots on the wire', () => {
        const converted = convertAgentMessage({
            type: 'reasoning',
            text: 'thinking',
            id: 'reasoning-stream-1',
            live: true
        });

        expect(converted).toEqual({
            type: 'reasoning',
            message: 'thinking',
            id: 'reasoning-stream-1',
            live: true
        });
    });

    it('omits the live marker from settled reasoning payloads', () => {
        const converted = convertAgentMessage({
            type: 'reasoning',
            text: 'thinking',
            id: 'reasoning-stream-1'
        });

        expect(converted !== null && 'live' in converted).toBe(false);
    });
});
