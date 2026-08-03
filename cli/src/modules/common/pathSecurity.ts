import { realpath } from 'fs/promises';
import { tmpdir } from 'os';
import { resolve, sep } from 'path';

export interface PathValidationResult {
    valid: boolean;
    error?: string;
}

export type ReadPathResolution =
    | { valid: true; path: string }
    | { valid: false; error: string };

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

function getSystemTemporaryDirectories(): string[] {
    const directories = [tmpdir()];
    if (process.platform !== 'win32') {
        directories.push('/tmp', '/var/tmp');
    }
    return [...new Set(directories.map((directory) => resolve(directory)))];
}

export async function resolveReadPath(targetPath: string, workingDirectory: string): Promise<ReadPathResolution> {
    const resolvedTarget = resolve(workingDirectory, targetPath);
    if (validatePath(resolvedTarget, workingDirectory).valid) {
        return { valid: true, path: resolvedTarget };
    }

    try {
        const canonicalTarget = await realpath(resolvedTarget);
        for (const temporaryDirectory of getSystemTemporaryDirectories()) {
            try {
                const canonicalTemporaryDirectory = await realpath(temporaryDirectory);
                if (isWithinPathRoot(canonicalTarget, canonicalTemporaryDirectory)) {
                    return { valid: true, path: canonicalTarget };
                }
            } catch {
                // Ignore unavailable temporary directory aliases.
            }
        }
    } catch {
        // Outside-workspace files must exist before their canonical location can be trusted.
    }

    return {
        valid: false,
        error: `Access denied: Path '${targetPath}' is outside the working and temporary directories`
    };
}
