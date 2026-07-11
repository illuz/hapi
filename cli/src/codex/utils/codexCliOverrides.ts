export type CodexCliOverrides = {
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'untrusted' | 'on-request' | 'never';
};

const SANDBOX_VALUES = new Set<CodexCliOverrides['sandbox']>([
    'read-only',
    'workspace-write',
    'danger-full-access'
]);

const APPROVAL_POLICY_VALUES = new Set<CodexCliOverrides['approvalPolicy']>([
    'untrusted',
    'on-request',
    'never'
]);

export function normalizeCodexCliArgs(args?: string[]): string[] {
    if (!args || args.length === 0) {
        return [];
    }

    const normalized: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            normalized.push(...args.slice(i));
            break;
        }

        if (arg === '--full-auto') {
            normalized.push('--ask-for-approval', 'on-request', '--sandbox', 'workspace-write');
            continue;
        }

        if ((arg === '-a' || arg === '--ask-for-approval') && args[i + 1] === 'on-failure') {
            normalized.push(arg, 'on-request');
            i += 1;
            continue;
        }

        if (arg === '--ask-for-approval=on-failure') {
            normalized.push('--ask-for-approval=on-request');
            continue;
        }

        normalized.push(arg);
    }

    return normalized;
}

export function parseCodexCliOverrides(args?: string[]): CodexCliOverrides {
    const overrides: CodexCliOverrides = {};
    const normalizedArgs = normalizeCodexCliArgs(args);
    if (normalizedArgs.length === 0) {
        return overrides;
    }

    for (let i = 0; i < normalizedArgs.length; i++) {
        const arg = normalizedArgs[i];
        if (arg === '--') {
            break;
        }

        if (arg === '--yolo') {
            overrides.approvalPolicy = 'never';
            overrides.sandbox = 'danger-full-access';
            continue;
        }

        if (arg === '--dangerously-bypass-approvals-and-sandbox') {
            overrides.approvalPolicy = 'never';
            overrides.sandbox = 'danger-full-access';
            continue;
        }

        if (arg === '-s' || arg === '--sandbox') {
            const value = normalizedArgs[i + 1];
            if (SANDBOX_VALUES.has(value as CodexCliOverrides['sandbox'])) {
                overrides.sandbox = value as CodexCliOverrides['sandbox'];
                i += 1;
            }
            continue;
        }

        if (arg.startsWith('--sandbox=')) {
            const value = arg.slice('--sandbox='.length);
            if (SANDBOX_VALUES.has(value as CodexCliOverrides['sandbox'])) {
                overrides.sandbox = value as CodexCliOverrides['sandbox'];
            }
            continue;
        }

        if (arg === '-a' || arg === '--ask-for-approval') {
            const value = normalizedArgs[i + 1];
            if (APPROVAL_POLICY_VALUES.has(value as CodexCliOverrides['approvalPolicy'])) {
                overrides.approvalPolicy = value as CodexCliOverrides['approvalPolicy'];
                i += 1;
            }
            continue;
        }

        if (arg.startsWith('--ask-for-approval=')) {
            const value = arg.slice('--ask-for-approval='.length);
            if (APPROVAL_POLICY_VALUES.has(value as CodexCliOverrides['approvalPolicy'])) {
                overrides.approvalPolicy = value as CodexCliOverrides['approvalPolicy'];
            }
        }
    }

    return overrides;
}

export function hasCodexCliOverrides(overrides?: CodexCliOverrides): boolean {
    return Boolean(overrides?.sandbox || overrides?.approvalPolicy);
}

export function stripCodexCliOverrides(args?: string[]): string[] {
    if (!args || args.length === 0) {
        return [];
    }

    const filtered: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            filtered.push(...args.slice(i));
            break;
        }

        if (
            arg === '--full-auto'
            || arg === '--yolo'
            || arg === '--dangerously-bypass-approvals-and-sandbox'
            || arg.startsWith('--sandbox=')
            || arg.startsWith('--ask-for-approval=')
        ) {
            continue;
        }

        if (arg === '-s' || arg === '--sandbox' || arg === '-a' || arg === '--ask-for-approval') {
            i += 1;
            continue;
        }

        filtered.push(arg);
    }

    return filtered;
}
