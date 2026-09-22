import { beforeEach, describe, expect, it } from 'vitest'
import {
    PLAYBACK_MODE_KEY,
    PLAYBACK_MODE_URL_PARAM,
    getStoredPlaybackMode,
    parseSoundPlaybackMode,
    setStoredPlaybackMode,
    toggleStoredPlaybackMute,
} from './readySound'

describe('notification sound playback mode', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/')
        window.localStorage.clear()
    })

    it('mutes and restores the previous active playback mode', () => {
        setStoredPlaybackMode('background')

        expect(window.localStorage.getItem(PLAYBACK_MODE_KEY)).toBe('background')
        expect(new URLSearchParams(window.location.search).get(PLAYBACK_MODE_URL_PARAM)).toBe('background')
        expect(toggleStoredPlaybackMute()).toBe('off')
        expect(getStoredPlaybackMode()).toBe('off')
        expect(new URLSearchParams(window.location.search).get(PLAYBACK_MODE_URL_PARAM)).toBe('off')

        expect(toggleStoredPlaybackMute()).toBe('background')
        expect(getStoredPlaybackMode()).toBe('background')
        expect(new URLSearchParams(window.location.search).get(PLAYBACK_MODE_URL_PARAM)).toBe('background')
    })

    it('restores always mode when no previous active mode exists', () => {
        window.localStorage.setItem(PLAYBACK_MODE_KEY, 'off')

        expect(toggleStoredPlaybackMute()).toBe('always')
        expect(getStoredPlaybackMode()).toBe('always')
    })

    it('uses the URL mode before local storage and persists it locally', () => {
        window.localStorage.setItem(PLAYBACK_MODE_KEY, 'background')
        window.history.replaceState(null, '', '/sessions?token=abc&sound=off#chat')

        expect(getStoredPlaybackMode()).toBe('off')
        expect(window.localStorage.getItem(PLAYBACK_MODE_KEY)).toBe('off')
        expect(toggleStoredPlaybackMute()).toBe('background')
        expect(window.location.search).toBe('?token=abc&sound=background')
        expect(window.location.hash).toBe('#chat')
    })

    it('falls back to local storage when the URL mode is invalid', () => {
        window.localStorage.setItem(PLAYBACK_MODE_KEY, 'background')
        window.history.replaceState(null, '', '/sessions?sound=loud')

        expect(getStoredPlaybackMode()).toBe('background')
    })

    it('parses only supported playback modes', () => {
        expect(parseSoundPlaybackMode('always')).toBe('always')
        expect(parseSoundPlaybackMode('background')).toBe('background')
        expect(parseSoundPlaybackMode('off')).toBe('off')
        expect(parseSoundPlaybackMode('loud')).toBeNull()
        expect(parseSoundPlaybackMode(null)).toBeNull()
    })
})
