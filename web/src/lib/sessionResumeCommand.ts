export function buildSessionResumeCommand(
    flavor: string | null | undefined,
    agentSessionId: string | null | undefined
): string | null {
    if (!agentSessionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(agentSessionId)) {
        return null
    }

    switch (flavor) {
        case 'codex':
            return `codex resume ${agentSessionId}`
        case 'gemini':
            return `gemini --resume ${agentSessionId}`
        case 'cursor':
            return `agent --resume ${agentSessionId}`
        case 'opencode':
            return `opencode --session ${agentSessionId}`
        case 'claude':
        case null:
        case undefined:
            return `claude --resume ${agentSessionId}`
        default:
            return null
    }
}
