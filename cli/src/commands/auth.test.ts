import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configuration } from '@/configuration'

const {
    readSettingsMock,
    clearMachineIdMock,
    updateSettingsMock,
    initializeApiUrlMock,
    questionMock,
    closeMock,
    createInterfaceMock
} = vi.hoisted(() => ({
    readSettingsMock: vi.fn(),
    clearMachineIdMock: vi.fn(),
    updateSettingsMock: vi.fn(),
    initializeApiUrlMock: vi.fn(async () => {
        configuration._setApiUrl('https://hapi.example.com')
    }),
    questionMock: vi.fn(),
    closeMock: vi.fn(),
    createInterfaceMock: vi.fn()
}))

vi.mock('@/persistence', () => ({
    readSettings: readSettingsMock,
    clearMachineId: clearMachineIdMock,
    updateSettings: updateSettingsMock
}))

vi.mock('@/ui/apiUrlInit', () => ({
    initializeApiUrl: initializeApiUrlMock
}))

vi.mock('node:readline/promises', () => ({
    createInterface: createInterfaceMock
}))

import { handleAuthCommand } from './auth'

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*m/g, '')
}

async function withInteractiveStdin(run: () => Promise<void>): Promise<void> {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    try {
        await run()
    } finally {
        if (descriptor) {
            Object.defineProperty(process.stdin, 'isTTY', descriptor)
        } else {
            Reflect.deleteProperty(process.stdin, 'isTTY')
        }
    }
}

describe('handleAuthCommand', () => {
    beforeEach(() => {
        configuration._setApiUrl('http://localhost:3006')
        configuration._setCliApiToken('')
        readSettingsMock.mockReset()
        clearMachineIdMock.mockReset()
        updateSettingsMock.mockReset()
        initializeApiUrlMock.mockClear()
        questionMock.mockReset()
        closeMock.mockReset()
        createInterfaceMock.mockReset()
        createInterfaceMock.mockReturnValue({
            question: questionMock,
            close: closeMock
        })
    })

    it('loads the configured api url before printing status', async () => {
        readSettingsMock.mockResolvedValue({
            apiUrl: 'https://hapi.example.com',
            cliApiToken: 'token-from-settings',
            machineId: 'machine-123'
        })

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        try {
            await handleAuthCommand(['status'])
            expect(initializeApiUrlMock).toHaveBeenCalledOnce()

            const output = logSpy.mock.calls
                .map((call) => stripAnsi(String(call[0])))
                .join('\n')

            expect(output).toContain('HAPI_API_URL: https://hapi.example.com')
            expect(output).toContain('CLI_API_TOKEN: set')
            expect(output).toContain('Machine ID: machine-123')
        } finally {
            logSpy.mockRestore()
        }
    })

    it.each([
        ['--host=https://hapi.example.com/', 'https://hapi.example.com'],
        ['--host', 'https://hapi.example.com/base/', 'https://hapi.example.com/base']
    ])('saves the token and Hub URL for login with %s', async (...args) => {
        const expectedHost = args.pop() as string
        questionMock.mockResolvedValue('  token-from-prompt  ')
        let savedSettings: Record<string, unknown> | undefined
        updateSettingsMock.mockImplementation(async (updater) => {
            savedSettings = await updater({ machineId: 'machine-123' })
            return savedSettings
        })
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        try {
            await withInteractiveStdin(() => handleAuthCommand(['login', ...args]))

            expect(savedSettings).toEqual({
                machineId: 'machine-123',
                cliApiToken: 'token-from-prompt',
                apiUrl: expectedHost
            })
            expect(configuration.apiUrl).toBe(expectedHost)
            expect(configuration.cliApiToken).toBe('token-from-prompt')
            expect(closeMock).toHaveBeenCalledOnce()
        } finally {
            logSpy.mockRestore()
        }
    })

    it.each([
        [['login', '--host'], '--host requires a value'],
        [['login', '--host=ftp://hapi.example.com'], '--host must use http:// or https://'],
        [['login', '--host=https://hapi.example.com?token=value'], '--host must not include a query string or fragment']
    ])('rejects an invalid login host', async (args, message) => {
        await expect(handleAuthCommand(args)).rejects.toThrow(message)
        expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('saves all login options without prompting', async () => {
        let savedSettings: Record<string, unknown> | undefined
        updateSettingsMock.mockImplementation(async (updater) => {
            savedSettings = await updater({ machineId: 'old-machine' })
            return savedSettings
        })
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        try {
            await handleAuthCommand([
                'login',
                '--host=https://hapi.example.com/',
                '--machineId=machine-123',
                '--cliApiToken=token-from-option'
            ])

            expect(savedSettings).toEqual({
                machineId: 'machine-123',
                cliApiToken: 'token-from-option',
                apiUrl: 'https://hapi.example.com'
            })
            expect(configuration.apiUrl).toBe('https://hapi.example.com')
            expect(configuration.cliApiToken).toBe('token-from-option')
            expect(createInterfaceMock).not.toHaveBeenCalled()
        } finally {
            logSpy.mockRestore()
        }
    })

    it.each([
        [['login', '--machineId='], '--machineId requires a value'],
        [['login', '--cliApiToken'], '--cliApiToken requires a value']
    ])('rejects an empty non-interactive option', async (args, message) => {
        await expect(handleAuthCommand(args)).rejects.toThrow(message)
        expect(updateSettingsMock).not.toHaveBeenCalled()
    })
})
