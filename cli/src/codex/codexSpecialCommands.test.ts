import { describe, expect, it } from 'vitest';
import { parseCodexSpecialCommand } from './codexSpecialCommands';

describe('parseCodexSpecialCommand', () => {
    it('accepts exact /clear, /compact, and /goal commands', () => {
        expect(parseCodexSpecialCommand('  /clear  ')).toEqual({ type: 'clear' });
        expect(parseCodexSpecialCommand('/compact')).toEqual({ type: 'compact' });
        expect(parseCodexSpecialCommand('/goal')).toEqual({ type: 'goal', action: 'show' });
    });

    it('rejects argument-bearing special commands without treating them as prompts', () => {
        expect(parseCodexSpecialCommand('/clear now')).toEqual({
            type: 'invalid',
            command: 'clear',
            message: '/clear does not accept arguments'
        });
        expect(parseCodexSpecialCommand('/compact summarize this')).toEqual({
            type: 'invalid',
            command: 'compact',
            message: '/compact does not accept arguments'
        });
    });

    it('ignores regular slash-like messages', () => {
        expect(parseCodexSpecialCommand('/clearing')).toEqual({ type: null });
        expect(parseCodexSpecialCommand('please /clear')).toEqual({ type: null });
    });

    it('parses /goal set and clear forms', () => {
        expect(parseCodexSpecialCommand('/goal ship the benchmark fix')).toEqual({
            type: 'goal',
            action: 'set',
            objective: 'ship the benchmark fix'
        });
        expect(parseCodexSpecialCommand('/goal clear')).toEqual({
            type: 'goal',
            action: 'clear'
        });
    });

    it('rejects unsupported /goal pause controls', () => {
        expect(parseCodexSpecialCommand('/goal pause')).toEqual({
            type: 'invalid',
            command: 'goal',
            message: '/goal pause is not supported in HAPI yet'
        });
        expect(parseCodexSpecialCommand('/goal unpause')).toEqual({
            type: 'invalid',
            command: 'goal',
            message: '/goal unpause is not supported in HAPI yet'
        });
    });
});
