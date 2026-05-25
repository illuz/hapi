import { resolve, sep } from 'path';

export interface PathValidationResult {
    valid: boolean;
    error?: string;
}

export function isWithinPathRoot(targetPath: string, rootPath: string): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedRoot = resolve(rootPath);

    const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
    const normalizedRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
    const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;

    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootPrefix);
}

/**
 * Validates that a path is within the allowed working directory
 * @param targetPath - The path to validate (can be relative or absolute)
 * @param workingDirectory - The session's working directory (must be absolute)
 * @returns Validation result
 */
export function validatePath(targetPath: string, workingDirectory: string): PathValidationResult {
    // Resolve both paths to absolute paths to handle path traversal attempts
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const resolvedWorkingDir = resolve(workingDirectory);

    // Check if the resolved target path starts with the working directory
    // This prevents access to files outside the working directory
    if (!isWithinPathRoot(resolvedTarget, resolvedWorkingDir)) {
        return {
            valid: false,
            error: `Access denied: Path '${targetPath}' is outside the working directory`
        };
    }

    return { valid: true };
}
