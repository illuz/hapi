#!/usr/bin/env bun
/**
 * Unified release script that handles the complete release flow:
 * 1. Bump version
 * 2. Build binaries (with embedded web assets)
 * 3. Publish platform packages first (so lockfile can resolve them)
 * 4. Publish main package
 * 5. bun install --lockfile-only --os=* --cpu=* (to lock all platform packages)
 * 6. Git commit + tag + push
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scriptDir = import.meta.dir;
const projectRoot = join(scriptDir, '..');
const repoRoot = join(projectRoot, '..');

// 解析参数
const args = process.argv.slice(2);
const version = args.find(arg => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const publishNpm = args.includes('--publish-npm');  // 只发布 npm，跳过 git 操作
const skipBuild = args.includes('--skip-build');    // 跳过构建（二进制已存在）
const otpIndex = args.indexOf('--otp');
const otp = otpIndex !== -1 ? args[otpIndex + 1] : undefined;
const npmToken = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
const npmRegistry = 'https://registry.npmjs.org';

if (!version) {
    console.error('Usage: bun run scripts/release-all.ts <version> [options]');
    console.error('Options:');
    console.error('  --dry-run      Preview the release process');
    console.error('  --publish-npm  Only publish to npm, skip git operations');
    console.error('  --skip-build   Skip building binaries (use existing)');
    console.error('  --otp <code>   One-time password for npm publish');
    console.error('Env:');
    console.error('  NPM_TOKEN / NODE_AUTH_TOKEN  Token auth for npm publish');
    console.error('Example: bun run scripts/release-all.ts 0.2.0');
    process.exit(1);
}

function createTemporaryNpmUserConfig(): string | null {
    if (!npmToken) {
        return null;
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'hapi-npm-auth-'));
    const userConfigPath = join(tempDir, '.npmrc');
    writeFileSync(userConfigPath, [
        `registry=${npmRegistry}`,
        'always-auth=true',
        `//registry.npmjs.org/:_authToken=${npmToken}`,
        ''
    ].join('\n'));
    return userConfigPath;
}

const npmUserConfigPath = createTemporaryNpmUserConfig();

function getCommandEnv(): NodeJS.ProcessEnv {
    if (!npmUserConfigPath) {
        return process.env;
    }
    return {
        ...process.env,
        NPM_CONFIG_USERCONFIG: npmUserConfigPath,
        npm_config_userconfig: npmUserConfigPath
    };
}

function run(cmd: string, cwd = projectRoot): void {
    console.log(`\n$ ${cmd}`);
    if (!dryRun) {
        execSync(cmd, {
            cwd,
            stdio: 'inherit',
            env: getCommandEnv()
        });
    }
}

function execText(cmd: string, cwd = projectRoot): string {
    return execSync(cmd, {
        cwd,
        stdio: 'pipe',
        encoding: 'utf-8',
        env: getCommandEnv()
    }).trim();
}

function packTarball(packageDir: string): string {
    const output = execText('npm pack --json', packageDir);
    const packResult = JSON.parse(output) as Array<{ filename?: string }>
    const filename = packResult[0]?.filename
    if (!filename) {
        throw new Error(`Failed to pack npm package in ${packageDir}`)
    }
    return join(packageDir, filename)
}

function readPackageName(packageDir: string): string {
    const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as {
        name?: string
    };
    if (!packageJson.name) {
        throw new Error(`Missing package name in ${join(packageDir, 'package.json')}`);
    }
    return packageJson.name;
}

function isVersionAlreadyPublished(packageName: string, packageVersion: string): boolean {
    const packageSpec = `${packageName}@${packageVersion}`;
    try {
        const output = execText(
            `npm view ${JSON.stringify(packageSpec)} version --json --registry ${npmRegistry}`
        );
        if (!output) {
            return false;
        }

        const parsed = JSON.parse(output) as string | string[];
        return Array.isArray(parsed)
            ? parsed.includes(packageVersion)
            : parsed === packageVersion;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
            message.includes('E404')
            || message.includes('404 Not Found')
            || message.includes('No match found for version')
        ) {
            return false;
        }
        throw error;
    }
}

function publishPreparedPackage(params: {
    packageDir: string
    packageVersion: string
    npmTag: string
    otpFlag: string
}): void {
    const packageName = readPackageName(params.packageDir);

    if (isVersionAlreadyPublished(packageName, params.packageVersion)) {
        console.log(`   ↷ Skipping ${packageName}@${params.packageVersion} (already published)`);
        return;
    }

    const tarball = packTarball(params.packageDir);
    run(
        `npm publish ${JSON.stringify(tarball)} --access public --tag ${params.npmTag} --ignore-scripts${params.otpFlag}${dryRun ? ' --dry-run' : ''}`,
        params.packageDir
    );
}

async function runWithTimeoutRetry(cmd: string, cwd = projectRoot): Promise<void> {
    const timeoutCmd = `timeout 60s ${cmd}`;
    while (true) {
        console.log(`\n$ ${timeoutCmd}`);
        if (dryRun) {
            return;
        }
        try {
            execSync(timeoutCmd, {
                cwd,
                stdio: 'inherit',
                env: getCommandEnv()
            });
            return;
        } catch {
            console.warn(`⚠️ ${cmd} failed or timed out. Retrying in 60s...`);
            await new Promise(resolve => setTimeout(resolve, 60_000));
        }
    }
}

async function main(): Promise<void> {
    const flags = [dryRun && 'dry-run', publishNpm && 'publish-npm', skipBuild && 'skip-build'].filter(Boolean);
    console.log(`\n🚀 Starting release v${version}${flags.length ? ` (${flags.join(', ')})` : ''}\n`);

    // Pre-check: Ensure we're on main branch
    console.log('🔍 Pre-checks...');
    const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8', cwd: repoRoot }).trim();
    if (currentBranch !== 'main') {
        console.error(`❌ Release must be run from main branch (current: ${currentBranch})`);
        process.exit(1);
    }
    console.log('   ✓ On main branch');

    // Pre-check: Ensure npm is logged in (skip in dry-run mode)
    if (!dryRun) {
        try {
            const npmUser = execText(`npm whoami --registry ${npmRegistry}`);
            if (npmToken) {
                console.log(`   ✓ Using npm token auth as: ${npmUser}`);
            } else {
                console.log(`   ✓ Logged in to npm as: ${npmUser}`);
            }
        } catch {
            console.error(npmToken
                ? '❌ npm token invalid or unavailable. Check NPM_TOKEN / NODE_AUTH_TOKEN.'
                : '❌ Not logged in to npm. Run `npm login` first.');
            process.exit(1);
        }
    } else {
        console.log('   ✓ Skipping npm login check (dry-run)');
    }

    // Step 1: Update package.json version
    console.log('📦 Step 1: Updating package.json version...');
    const pkgPath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const oldVersion = pkg.version;
    pkg.version = version;
    if (!dryRun) {
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
    console.log(`   ${oldVersion} → ${version}`);

    // Step 2: Build all platform binaries (with embedded web assets)
    if (!skipBuild) {
        console.log('\n🔨 Step 2: Building all platform binaries with web assets...');
        run('bun run build:single-exe:all', repoRoot);
    } else {
        console.log('\n🔨 Step 2: Skipping build (--skip-build)');
    }

    // Step 3: Prepare and publish platform packages
    console.log('\n📤 Step 3: Publishing platform packages...');
    run('bun run prepare-npm-packages');
    const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];
    const npmTag = version.includes('-') ? 'next' : 'latest';
    const otpFlag = otp ? ` --otp ${otp}` : '';
    for (const platform of platforms) {
        const npmDir = join(projectRoot, 'npm', platform);
        publishPreparedPackage({
            packageDir: npmDir,
            packageVersion: version,
            npmTag,
            otpFlag
        });
    }

    // Step 4: Publish main package
    console.log('\n📤 Step 4: Publishing main package...');
    const mainNpmDir = join(projectRoot, 'npm', 'main');
    publishPreparedPackage({
        packageDir: mainNpmDir,
        packageVersion: version,
        npmTag,
        otpFlag
    });

    // --publish-npm 模式到此结束
    if (publishNpm) {
        console.log(`\n✅ Published v${version} to npm!`);
        return;
    }

    // Step 5: bun install to get complete lockfile
    console.log('\n📥 Step 5: Updating lockfile for all platform packages...');

    await runWithTimeoutRetry('bun install --lockfile-only --os=* --cpu=*', repoRoot);
    // Step 6: Git commit + tag + push
    console.log('\n📝 Step 6: Creating git commit and tag...');
    run(`git add .`, repoRoot);
    run(`git commit -m "Release version ${version}"`, repoRoot);
    run(`git tag v${version}`, repoRoot);
    run(`git push && git push --tags`, repoRoot);

    console.log(`\n✅ Release v${version} completed!`);
}

main().catch(err => {
    console.error('Release failed:', err);
    process.exit(1);
}).finally(() => {
    if (npmUserConfigPath) {
        rmSync(join(npmUserConfigPath, '..'), { recursive: true, force: true });
    }
});
