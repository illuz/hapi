let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
        return null
    }

    const AudioContextConstructor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextConstructor) {
        return null
    }

    if (!audioContext) {
        audioContext = new AudioContextConstructor()
    }

    return audioContext
}

function scheduleTone(
    context: AudioContext,
    type: OscillatorType,
    frequency: number,
    startAt: number,
    duration: number,
    peakGain: number,
    destination: AudioNode,
    detune: number = 0
): void {
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startAt)
    oscillator.detune.setValueAtTime(detune, startAt)

    gainNode.gain.setValueAtTime(0.0001, startAt)
    gainNode.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(peakGain * 0.7, startAt + duration * 0.45)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

    oscillator.connect(gainNode)
    gainNode.connect(destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + duration + 0.05)

    oscillator.addEventListener('ended', () => {
        oscillator.disconnect()
        gainNode.disconnect()
    })
}

function playCrystalReadySound(context: AudioContext, startAt: number): void {
    const masterGain = context.createGain()
    const compressor = context.createDynamicsCompressor()

    masterGain.gain.setValueAtTime(0.8, startAt)
    compressor.threshold.setValueAtTime(-18, startAt)
    compressor.knee.setValueAtTime(18, startAt)
    compressor.ratio.setValueAtTime(10, startAt)
    compressor.attack.setValueAtTime(0.003, startAt)
    compressor.release.setValueAtTime(0.18, startAt)

    masterGain.connect(compressor)
    compressor.connect(context.destination)

    scheduleTone(context, 'triangle', 740, startAt, 0.11, 0.09, masterGain)
    scheduleTone(context, 'triangle', 1110, startAt + 0.08, 0.12, 0.08, masterGain, 4)
    scheduleTone(context, 'sine', 1480, startAt + 0.16, 0.28, 0.07, masterGain)
    scheduleTone(context, 'square', 2220, startAt + 0.17, 0.14, 0.018, masterGain)

    const echo = context.createDelay()
    const echoGain = context.createGain()
    echo.delayTime.setValueAtTime(0.11, startAt)
    echoGain.gain.setValueAtTime(0.16, startAt)
    masterGain.connect(echo)
    echo.connect(echoGain)
    echoGain.connect(compressor)

    window.setTimeout(() => {
        masterGain.disconnect()
        compressor.disconnect()
        echo.disconnect()
        echoGain.disconnect()
    }, 1200)
}

function playAlertReadySound(context: AudioContext, startAt: number): void {
    const masterGain = context.createGain()
    const compressor = context.createDynamicsCompressor()

    masterGain.gain.setValueAtTime(0.72, startAt)
    compressor.threshold.setValueAtTime(-20, startAt)
    compressor.knee.setValueAtTime(20, startAt)
    compressor.ratio.setValueAtTime(12, startAt)
    compressor.attack.setValueAtTime(0.002, startAt)
    compressor.release.setValueAtTime(0.12, startAt)

    masterGain.connect(compressor)
    compressor.connect(context.destination)

    scheduleTone(context, 'square', 880, startAt, 0.08, 0.05, masterGain)
    scheduleTone(context, 'square', 880, startAt + 0.12, 0.08, 0.05, masterGain)
    scheduleTone(context, 'triangle', 1320, startAt + 0.24, 0.16, 0.05, masterGain)

    window.setTimeout(() => {
        masterGain.disconnect()
        compressor.disconnect()
    }, 800)
}

function playChimeReadySound(context: AudioContext, startAt: number): void {
    const masterGain = context.createGain()
    masterGain.gain.setValueAtTime(0.55, startAt)
    masterGain.connect(context.destination)

    scheduleTone(context, 'sine', 880, startAt, 0.16, 0.05, masterGain)
    scheduleTone(context, 'sine', 1320, startAt + 0.14, 0.22, 0.04, masterGain)

    window.setTimeout(() => {
        masterGain.disconnect()
    }, 700)
}

export async function playNotificationSound(variant: 'chime' | 'crystal' | 'alert' = 'crystal'): Promise<void> {
    const context = getAudioContext()
    if (!context) {
        return
    }

    try {
        if (context.state === 'suspended') {
            await context.resume()
        }
        if (context.state !== 'running') {
            return
        }

        const startAt = context.currentTime + 0.01
        if (variant === 'alert') {
            playAlertReadySound(context, startAt)
        } else if (variant === 'chime') {
            playChimeReadySound(context, startAt)
        } else {
            playCrystalReadySound(context, startAt)
        }
    } catch {
        // Ignore browsers that block audio playback without a recent user gesture.
    }
}

export async function playReadyChime(variant: 'chime' | 'crystal' = 'crystal'): Promise<void> {
    await playNotificationSound(variant)
}
