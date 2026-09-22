import chalk from 'chalk'
import os from 'node:os'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, clearMachineId, updateSettings } from '@/persistence'
import { initializeApiUrl } from '@/ui/apiUrlInit'
import type { CommandDefinition } from './types'

function normalizeHubUrl(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        throw new Error('--host requires a Hub URL')
    }

    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        throw new Error(`Invalid --host URL: ${trimmed}`)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('--host must use http:// or https://')
    }
    if (parsed.search || parsed.hash) {
        throw new Error('--host must not include a query string or fragment')
    }

    return parsed.toString().replace(/\/+$/, '')
}

interface LoginOptions {
    host?: string
    machineId?: string
    cliApiToken?: string
}

function requireOptionValue(option: string, value: string | undefined): string {
    const trimmed = value?.trim()
    if (!trimmed || trimmed.startsWith('--')) {
        throw new Error(`${option} requires a value`)
    }
    return trimmed
}

function parseLoginOptions(args: string[]): LoginOptions {
    const options: LoginOptions = {}

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--host') {
            options.host = normalizeHubUrl(requireOptionValue('--host', args[++i]))
        } else if (arg.startsWith('--host=')) {
            options.host = normalizeHubUrl(arg.slice('--host='.length))
        } else if (arg === '--machineId') {
            options.machineId = requireOptionValue('--machineId', args[++i])
        } else if (arg.startsWith('--machineId=')) {
            options.machineId = requireOptionValue('--machineId', arg.slice('--machineId='.length))
        } else if (arg === '--cliApiToken') {
            options.cliApiToken = requireOptionValue('--cliApiToken', args[++i])
        } else if (arg.startsWith('--cliApiToken=')) {
            options.cliApiToken = requireOptionValue('--cliApiToken', arg.slice('--cliApiToken='.length))
        }
    }

    return options
}

export async function handleAuthCommand(args: string[]): Promise<void> {
    const subcommand = args[0]

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        showHelp()
        return
    }

    if (subcommand === 'status') {
        await initializeApiUrl()
        const settings = await readSettings()
        const envToken = process.env.CLI_API_TOKEN
        const settingsToken = settings.cliApiToken
        const hasToken = Boolean(envToken || settingsToken)
        const tokenSource = envToken ? 'environment' : (settingsToken ? 'settings file' : 'none')
        console.log(chalk.bold('\nDirect Connect Status\n'))
        console.log(chalk.gray(`  HAPI_API_URL: ${configuration.apiUrl}`))
        console.log(chalk.gray(`  CLI_API_TOKEN: ${hasToken ? 'set' : 'missing'}`))
        console.log(chalk.gray(`  Token Source: ${tokenSource}`))
        console.log(chalk.gray(`  Machine ID: ${settings.machineId ?? 'not set'}`))
        console.log(chalk.gray(`  Host: ${os.hostname()}`))

        if (!hasToken) {
            console.log('')
            console.log(chalk.yellow('  Token not configured. To get your token:'))
            console.log(chalk.gray('    1. Check the server startup logs (first run shows generated token)'))
            console.log(chalk.gray('    2. Read ~/.hapi/settings.json on the server'))
            console.log(chalk.gray('    3. Ask your server administrator (if token is set via env var)'))
            console.log('')
            console.log(chalk.gray('  Then run: hapi auth login'))
        }
        return
    }

    if (subcommand === 'login') {
        const { host, machineId, cliApiToken } = parseLoginOptions(args.slice(1))
        let token = cliApiToken

        if (!token && !process.stdin.isTTY) {
            console.error(chalk.red('Cannot prompt for token in non-TTY environment.'))
            console.error(chalk.gray('Pass --cliApiToken or run `hapi auth login` in an interactive terminal.'))
            process.exit(1)
        }

        if (!token) {
            const rl = readline.createInterface({ input, output })

            try {
                token = (await rl.question(chalk.cyan('Enter CLI_API_TOKEN: '))).trim()

                if (!token) {
                    console.error(chalk.red('Token cannot be empty'))
                    process.exit(1)
                }
            } finally {
                rl.close()
            }
        }

        await updateSettings(current => ({
            ...current,
            cliApiToken: token,
            ...(host ? { apiUrl: host } : {}),
            ...(machineId ? { machineId } : {})
        }))
        configuration._setCliApiToken(token)
        if (host) {
            configuration._setApiUrl(host)
        }
        console.log(chalk.green(`\nAuthentication saved to ${configuration.settingsFile}`))
        if (host) {
            console.log(chalk.green(`Hub URL saved: ${host}`))
        }
        if (machineId) {
            console.log(chalk.green(`Machine ID saved: ${machineId}`))
        }
        return
    }

    if (subcommand === 'logout') {
        await updateSettings(current => ({
            ...current,
            cliApiToken: undefined
        }))
        await clearMachineId()
        console.log(chalk.green('Cleared local credentials (token and machineId).'))
        console.log(chalk.gray('Note: If CLI_API_TOKEN is set via environment variable, it will still be used.'))
        return
    }

    console.error(chalk.red(`Unknown auth subcommand: ${subcommand}`))
    showHelp()
    process.exit(1)
}

function showHelp(): void {
    console.log(`
${chalk.bold('hapi auth')} - Authentication management

${chalk.bold('Usage:')}
  hapi auth status            Show current configuration
  hapi auth login [options]   Save authentication settings
  hapi auth logout            Clear saved credentials

${chalk.bold('Login options:')}
  --host <url>                Save a self-hosted Hub URL (http:// or https://)
  --machineId <id>            Save a specific machine ID
  --cliApiToken <token>       Save the token without an interactive prompt

${chalk.bold('Token priority (highest to lowest):')}
  1. CLI_API_TOKEN environment variable
  2. ~/.hapi/settings.json
  3. Interactive prompt (on first run)
`)
}

export const authCommand: CommandDefinition = {
    name: 'auth',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            await handleAuthCommand(commandArgs)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
