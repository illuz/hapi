export const READY_SOUND_KEY = 'hapi-ready-sound'
export const PLAYBACK_MODE_KEY = 'hapi-notification-sound-mode'
export const EVENT_SOUND_KEYS = {
    ready: 'hapi-sound-ready',
    permission: 'hapi-sound-permission',
    message: 'hapi-sound-message',
    failure: 'hapi-sound-failure',
    general: 'hapi-sound-general',
} as const

export type SoundVariant =
    | 'off'
    | 'chime'
    | 'crystal'
    | 'alert'
    | 'building'
    | 'constructionComplete'
    | 'missionAccomplished'
    | 'newConstructionOptions'
    | 'onMyWay'
    | 'orders'
    | 'unitReady'
    | 'sirYesSir'
    | 'youHaveLost'
export type SoundEvent = keyof typeof EVENT_SOUND_KEYS
export type SoundPlaybackMode = 'always' | 'background' | 'off'

export function getSoundVariantOptions(): Array<{ value: SoundVariant; labelKey: string }> {
    return [
        { value: 'constructionComplete', labelKey: 'settings.sound.option.constructionComplete' },
        { value: 'unitReady', labelKey: 'settings.sound.option.unitReady' },
        { value: 'building', labelKey: 'settings.sound.option.building' },
        { value: 'newConstructionOptions', labelKey: 'settings.sound.option.newConstructionOptions' },
        { value: 'missionAccomplished', labelKey: 'settings.sound.option.missionAccomplished' },
        { value: 'youHaveLost', labelKey: 'settings.sound.option.youHaveLost' },
        { value: 'orders', labelKey: 'settings.sound.option.orders' },
        { value: 'onMyWay', labelKey: 'settings.sound.option.onMyWay' },
        { value: 'sirYesSir', labelKey: 'settings.sound.option.sirYesSir' },
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
    if (event === 'ready') return 'constructionComplete'
    if (event === 'permission') return 'sirYesSir'
    if (event === 'message') return 'building'
    if (event === 'failure') return 'youHaveLost'
    return 'onMyWay'
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
    if (
        raw === 'off'
        || raw === 'chime'
        || raw === 'crystal'
        || raw === 'alert'
        || raw === 'building'
        || raw === 'constructionComplete'
        || raw === 'missionAccomplished'
        || raw === 'newConstructionOptions'
        || raw === 'onMyWay'
        || raw === 'orders'
        || raw === 'unitReady'
        || raw === 'sirYesSir'
        || raw === 'youHaveLost'
    ) {
        return raw
    }

    if (event === 'ready') {
        const legacy = getStorageItem(READY_SOUND_KEY)
        if (
            legacy === 'off'
            || legacy === 'chime'
            || legacy === 'crystal'
            || legacy === 'alert'
            || legacy === 'building'
            || legacy === 'constructionComplete'
            || legacy === 'missionAccomplished'
            || legacy === 'newConstructionOptions'
            || legacy === 'onMyWay'
            || legacy === 'orders'
            || legacy === 'unitReady'
            || legacy === 'sirYesSir'
            || legacy === 'youHaveLost'
        ) {
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
