import { isRunnerRunningCurrentlyInstalledHappyVersion } from '@/runner/controlClient'
import { spawnHappyCLI } from '@/utils/spawnHappyCLI'
import { logger } from '@/ui/logger'

let ensureRunnerStartedPromise: Promise<void> | null = null

export async function ensureRunnerStarted(): Promise<void> {
    if (ensureRunnerStartedPromise) {
        return ensureRunnerStartedPromise
    }

    ensureRunnerStartedPromise = (async () => {
        logger.debug('[RUNNER AUTO-START] Checking runner status')
        if (await isRunnerRunningCurrentlyInstalledHappyVersion()) {
            return
        }

        logger.debug('[RUNNER AUTO-START] Starting runner automatically')
        const runnerProcess = spawnHappyCLI(['runner', 'start-sync'], {
            detached: true,
            stdio: 'ignore',
            env: process.env
        })
        runnerProcess.unref()

        await new Promise((resolve) => setTimeout(resolve, 200))
    })().finally(() => {
        ensureRunnerStartedPromise = null
    })

    return ensureRunnerStartedPromise
}
