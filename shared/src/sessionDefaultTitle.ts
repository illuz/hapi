export function getDefaultSessionTitle(flavor?: string | null): string | null {
    if (flavor === 'codex') {
        return 'Codex新建会话'
    }
    if (flavor === 'claude') {
        return 'Claude新建会话'
    }
    return null
}
