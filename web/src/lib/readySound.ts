export const READY_SOUND_KEY = 'hapi-ready-sound'
export const PLAYBACK_MODE_KEY = 'hapi-notification-sound-mode'
export const EVENT_SOUND_KEYS = {
    ready: 'hapi-sound-ready',
    permission: 'hapi-sound-permission',
    general: 'hapi-sound-general',
} as const

export type SoundVariant = 'off' | 'chime' | 'crystal' | 'alert'
export type SoundEvent = keyof typeof EVENT_SOUND_KEYS
export type SoundPlaybackMode = 'always' | 'background' | 'off'

export function getSoundVariantOptions(): Array<{ value: SoundVariant; labelKey: string }> {
    return [
        { value: 'crystal', labelKey: 'settings.sound.option.crystal' },
        { value: 'chime', labelKey: 'settings.sound.option.chime' },
        { value: 'alert', labelKey: 'settings.sound.option.alert' },
        { value: 'off', labelKey: 'settings.sound.option.off' },
    ]
}

export function getPlaybackModeOptions(): Array<{ value: SoundPlaybackMode; labelKey: string }> {
    return [
        { value: 'always', labelKey: 'settings.sound.playback.always' },
        { value: 'background', labelKey: 'settings.sound.playback.background' },
        { value: 'off', labelKey: 'settings.sound.playback.off' },
    ]
}

function getStorageItem(key: string): string | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

function setStorageItem(key: string, value: string): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(key, value)
    } catch {
    }
}

function getDefaultSoundForEvent(event: SoundEvent): SoundVariant {
    if (event === 'ready') return 'crystal'
    if (event === 'permission') return 'alert'
    return 'chime'
}

export function getStoredPlaybackMode(): SoundPlaybackMode {
    const raw = getStorageItem(PLAYBACK_MODE_KEY)
    if (raw === 'always' || raw === 'background' || raw === 'off') {
        return raw
    }
    return 'always'
}

export function setStoredPlaybackMode(value: SoundPlaybackMode): void {
    setStorageItem(PLAYBACK_MODE_KEY, value)
}

export function getStoredEventSound(event: SoundEvent): SoundVariant {
    const key = EVENT_SOUND_KEYS[event]
    const raw = getStorageItem(key)
    if (raw === 'off' || raw === 'chime' || raw === 'crystal' || raw === 'alert') {
        return raw
    }

    if (event === 'ready') {
        const legacy = getStorageItem(READY_SOUND_KEY)
        if (legacy === 'off' || legacy === 'chime' || legacy === 'crystal') {
            return legacy
        }
    }

    return getDefaultSoundForEvent(event)
}

export function setStoredEventSound(event: SoundEvent, value: SoundVariant): void {
    setStorageItem(EVENT_SOUND_KEYS[event], value)
    if (event === 'ready') {
        setStorageItem(READY_SOUND_KEY, value)
    }
}
