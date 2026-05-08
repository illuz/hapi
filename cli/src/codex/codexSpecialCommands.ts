export type CodexSpecialCommand =
    | { type: 'clear' | 'compact' }
    | { type: 'goal'; action: 'show' | 'set' | 'clear'; objective?: string }
    | { type: 'invalid'; command: 'goal'; message: string }
    | { type: 'invalid'; command: 'clear' | 'compact'; message: string }
    | { type: null };

export function parseCodexSpecialCommand(message: string): CodexSpecialCommand {
    const trimmed = message.trim();
    if (trimmed === '/clear') {
        return { type: 'clear' };
    }
    if (trimmed === '/compact') {
        return { type: 'compact' };
    }
    if (trimmed.startsWith('/clear ')) {
        return {
            type: 'invalid',
            command: 'clear',
            message: '/clear does not accept arguments'
        };
    }
    if (trimmed.startsWith('/compact ')) {
        return {
            type: 'invalid',
            command: 'compact',
            message: '/compact does not accept arguments'
        };
    }
    if (trimmed === '/goal') {
        return { type: 'goal', action: 'show' };
    }
    if (trimmed.startsWith('/goal ')) {
        const rest = trimmed.slice('/goal'.length).trim();
        const lowered = rest.toLowerCase();
        if (!rest) {
            return { type: 'goal', action: 'show' };
        }
        if (lowered === 'clear') {
            return { type: 'goal', action: 'clear' };
        }
        if (lowered === 'pause' || lowered === 'unpause') {
            return {
                type: 'invalid',
                command: 'goal',
                message: `/goal ${lowered} is not supported in HAPI yet`
            };
        }
        return {
            type: 'goal',
            action: 'set',
            objective: rest
        };
    }
    return { type: null };
}
