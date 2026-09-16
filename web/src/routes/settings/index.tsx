import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { getElevenLabsSupportedLanguages, getLanguageDisplayName, type Language } from '@/lib/languages'
import { getFontScaleOptions, useFontScale, type FontScale } from '@/hooks/useFontScale'
import { getTerminalFontSizeOptions, useTerminalFontSize, type TerminalFontSize } from '@/hooks/useTerminalFontSize'
import { getComposerEnterBehaviorOptions, useComposerEnterBehavior, type ComposerEnterBehavior } from '@/hooks/useComposerEnterBehavior'
import { useAppearance, getAppearanceOptions, type AppearancePreference } from '@/hooks/useTheme'
import { playNotificationSound } from '@/lib/readyChime'
import {
    getPlaybackModeOptions,
    getSoundVariantOptions,
    getStoredEventSound,
    getStoredPlaybackMode,
    setStoredEventSound,
    setStoredPlaybackMode,
    type SoundPlaybackMode,
    type SoundVariant,
} from '@/lib/readySound'
import {
    CODEX_REASONING_EFFORT_LABELS,
    CODEX_REASONING_EFFORT_PRESETS,
    PROTOCOL_VERSION,
    type CodexReasoningEffortPreset
} from '@hapi/protocol'
import type { CustomCodexModel } from '@/types/api'
import { useOptionalAppContext } from '@/lib/app-context'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

const locales: { value: Locale; nativeLabel: string }[] = [
    { value: 'en', nativeLabel: 'English' },
    { value: 'zh-CN', nativeLabel: '简体中文' },
]

const voiceLanguages = getElevenLabsSupportedLanguages()

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function CheckIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function RemoveIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

export default function SettingsPage() {
    const { t, locale, setLocale } = useTranslation()
    const appContext = useOptionalAppContext()
    const settingsApi = appContext?.api ?? null
    const goBack = useAppGoBack()
    const [isOpen, setIsOpen] = useState(false)
    const [isAppearanceOpen, setIsAppearanceOpen] = useState(false)
    const [isFontOpen, setIsFontOpen] = useState(false)
    const [isTerminalFontOpen, setIsTerminalFontOpen] = useState(false)
    const [isChatOpen, setIsChatOpen] = useState(false)
    const [isVoiceOpen, setIsVoiceOpen] = useState(false)
    const [isPlaybackModeOpen, setIsPlaybackModeOpen] = useState(false)
    const [isReadySoundOpen, setIsReadySoundOpen] = useState(false)
    const [isPermissionSoundOpen, setIsPermissionSoundOpen] = useState(false)
    const [isMessageSoundOpen, setIsMessageSoundOpen] = useState(false)
    const [isFailureSoundOpen, setIsFailureSoundOpen] = useState(false)
    const [isGeneralSoundOpen, setIsGeneralSoundOpen] = useState(false)
    const [isRefreshingApp, setIsRefreshingApp] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const appearanceContainerRef = useRef<HTMLDivElement>(null)
    const fontContainerRef = useRef<HTMLDivElement>(null)
    const terminalFontContainerRef = useRef<HTMLDivElement>(null)
    const chatContainerRef = useRef<HTMLDivElement>(null)
    const voiceContainerRef = useRef<HTMLDivElement>(null)
    const playbackModeContainerRef = useRef<HTMLDivElement>(null)
    const readySoundContainerRef = useRef<HTMLDivElement>(null)
    const permissionSoundContainerRef = useRef<HTMLDivElement>(null)
    const messageSoundContainerRef = useRef<HTMLDivElement>(null)
    const failureSoundContainerRef = useRef<HTMLDivElement>(null)
    const generalSoundContainerRef = useRef<HTMLDivElement>(null)
    const { fontScale, setFontScale } = useFontScale()
    const { terminalFontSize, setTerminalFontSize } = useTerminalFontSize()
    const { composerEnterBehavior, setComposerEnterBehavior } = useComposerEnterBehavior()
    const { appearance, setAppearance } = useAppearance()

    // Voice language state - read from localStorage
    const [voiceLanguage, setVoiceLanguage] = useState<string | null>(() => {
        return localStorage.getItem('hapi-voice-lang')
    })
    const [playbackMode, setPlaybackMode] = useState<SoundPlaybackMode>(getStoredPlaybackMode)
    const [readySound, setReadySound] = useState<SoundVariant>(() => getStoredEventSound('ready'))
    const [permissionSound, setPermissionSound] = useState<SoundVariant>(() => getStoredEventSound('permission'))
    const [messageSound, setMessageSound] = useState<SoundVariant>(() => getStoredEventSound('message'))
    const [failureSound, setFailureSound] = useState<SoundVariant>(() => getStoredEventSound('failure'))
    const [generalSound, setGeneralSound] = useState<SoundVariant>(() => getStoredEventSound('general'))
    const [customCodexModels, setCustomCodexModels] = useState<CustomCodexModel[]>([])
    const [customCodexModelId, setCustomCodexModelId] = useState('')
    const [customCodexModelName, setCustomCodexModelName] = useState('')
    const [customCodexReasoningEfforts, setCustomCodexReasoningEfforts] = useState<CodexReasoningEffortPreset[]>([])
    const [customCodexModelsLoading, setCustomCodexModelsLoading] = useState(false)
    const [customCodexModelsSaving, setCustomCodexModelsSaving] = useState(false)
    const [customCodexModelRemoving, setCustomCodexModelRemoving] = useState<string | null>(null)
    const [customCodexModelsError, setCustomCodexModelsError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        if (!settingsApi) {
            setCustomCodexModels([])
            setCustomCodexModelsLoading(false)
            return () => {
                cancelled = true
            }
        }

        setCustomCodexModelsLoading(true)
        setCustomCodexModelsError(null)
        settingsApi.getCustomCodexModels()
            .then((response) => {
                if (!cancelled) {
                    setCustomCodexModels(response.models)
                    queryClient.setQueryData(queryKeys.customCodexModels, response)
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setCustomCodexModelsError(error instanceof Error ? error.message : t('settings.codexModels.loadFailed'))
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setCustomCodexModelsLoading(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [settingsApi, t])

    const fontScaleOptions = getFontScaleOptions()
    const terminalFontSizeOptions = getTerminalFontSizeOptions()
    const composerEnterBehaviorOptions = getComposerEnterBehaviorOptions()
    const appearanceOptions = getAppearanceOptions()
    const playbackModeOptions = getPlaybackModeOptions()
    const soundVariantOptions = getSoundVariantOptions()
    const currentLocale = locales.find((loc) => loc.value === locale)
    const currentAppearanceLabel = appearanceOptions.find((opt) => opt.value === appearance)?.labelKey ?? 'settings.display.appearance.system'
    const currentFontScaleLabel = fontScaleOptions.find((opt) => opt.value === fontScale)?.label ?? '100%'
    const currentTerminalFontSizeLabel = terminalFontSizeOptions.find((opt) => opt.value === terminalFontSize)?.label ?? '13px'
    const currentComposerEnterBehaviorLabel = composerEnterBehaviorOptions.find((opt) => opt.value === composerEnterBehavior)?.labelKey ?? 'settings.chat.enterBehavior.send'
    const currentVoiceLanguage = voiceLanguages.find((lang) => lang.code === voiceLanguage)
    const currentPlaybackModeLabel = playbackModeOptions.find((opt) => opt.value === playbackMode)?.labelKey ?? 'settings.sound.playback.always'
    const currentReadySoundLabel = soundVariantOptions.find((opt) => opt.value === readySound)?.labelKey ?? 'settings.sound.option.constructionComplete'
    const currentPermissionSoundLabel = soundVariantOptions.find((opt) => opt.value === permissionSound)?.labelKey ?? 'settings.sound.option.sirYesSir'
    const currentMessageSoundLabel = soundVariantOptions.find((opt) => opt.value === messageSound)?.labelKey ?? 'settings.sound.option.building'
    const currentFailureSoundLabel = soundVariantOptions.find((opt) => opt.value === failureSound)?.labelKey ?? 'settings.sound.option.youHaveLost'
    const currentGeneralSoundLabel = soundVariantOptions.find((opt) => opt.value === generalSound)?.labelKey ?? 'settings.sound.option.onMyWay'

    const handleLocaleChange = (newLocale: Locale) => {
        setLocale(newLocale)
        setIsOpen(false)
    }

    const handleAppearanceChange = (pref: AppearancePreference) => {
        setAppearance(pref)
        setIsAppearanceOpen(false)
    }

    const handleFontScaleChange = (newScale: FontScale) => {
        setFontScale(newScale)
        setIsFontOpen(false)
    }

    const handleTerminalFontSizeChange = (newSize: TerminalFontSize) => {
        setTerminalFontSize(newSize)
        setIsTerminalFontOpen(false)
    }

    const handleComposerEnterBehaviorChange = (newBehavior: ComposerEnterBehavior) => {
        setComposerEnterBehavior(newBehavior)
        setIsChatOpen(false)
    }

    const handleVoiceLanguageChange = (language: Language) => {
        setVoiceLanguage(language.code)
        if (language.code === null) {
            localStorage.removeItem('hapi-voice-lang')
        } else {
            localStorage.setItem('hapi-voice-lang', language.code)
        }
        setIsVoiceOpen(false)
    }

    const handlePlaybackModeChange = (value: SoundPlaybackMode) => {
        setPlaybackMode(value)
        setStoredPlaybackMode(value)
        setIsPlaybackModeOpen(false)
    }

    const handleReadySoundChange = (value: SoundVariant) => {
        setReadySound(value)
        setStoredEventSound('ready', value)
        setIsReadySoundOpen(false)
    }

    const handlePermissionSoundChange = (value: SoundVariant) => {
        setPermissionSound(value)
        setStoredEventSound('permission', value)
        setIsPermissionSoundOpen(false)
    }

    const handleMessageSoundChange = (value: SoundVariant) => {
        setMessageSound(value)
        setStoredEventSound('message', value)
        setIsMessageSoundOpen(false)
    }

    const handleFailureSoundChange = (value: SoundVariant) => {
        setFailureSound(value)
        setStoredEventSound('failure', value)
        setIsFailureSoundOpen(false)
    }

    const handleGeneralSoundChange = (value: SoundVariant) => {
        setGeneralSound(value)
        setStoredEventSound('general', value)
        setIsGeneralSoundOpen(false)
    }

    const handleAddCustomCodexModel = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!settingsApi || customCodexModelsSaving) {
            return
        }

        const id = customCodexModelId.trim()
        if (!id || /\s/.test(id)) {
            setCustomCodexModelsError(t('settings.codexModels.invalidId'))
            return
        }

        setCustomCodexModelsSaving(true)
        setCustomCodexModelsError(null)
        try {
            const response = await settingsApi.saveCustomCodexModel({
                id,
                displayName: customCodexModelName.trim() || null,
                supportedReasoningEfforts: customCodexReasoningEfforts
            })
            const nextModels = [
                ...customCodexModels.filter((model) => model.id !== response.model.id),
                response.model
            ]
            setCustomCodexModels(nextModels)
            queryClient.setQueryData(queryKeys.customCodexModels, { models: nextModels })
            setCustomCodexModelId('')
            setCustomCodexModelName('')
            setCustomCodexReasoningEfforts([])
        } catch (error) {
            setCustomCodexModelsError(error instanceof Error ? error.message : t('settings.codexModels.saveFailed'))
        } finally {
            setCustomCodexModelsSaving(false)
        }
    }

    const handleCustomCodexReasoningEffortChange = (
        effort: CodexReasoningEffortPreset,
        checked: boolean
    ) => {
        setCustomCodexReasoningEfforts((current) => checked
            ? [...current, effort]
            : current.filter((entry) => entry !== effort))
    }

    const handleRemoveCustomCodexModel = async (model: CustomCodexModel) => {
        if (!settingsApi || customCodexModelRemoving) {
            return
        }

        setCustomCodexModelRemoving(model.id)
        setCustomCodexModelsError(null)
        try {
            await settingsApi.deleteCustomCodexModel(model.id)
            const nextModels = customCodexModels.filter((entry) => entry.id !== model.id)
            setCustomCodexModels(nextModels)
            queryClient.setQueryData(queryKeys.customCodexModels, { models: nextModels })
        } catch (error) {
            setCustomCodexModelsError(error instanceof Error ? error.message : t('settings.codexModels.removeFailed'))
        } finally {
            setCustomCodexModelRemoving(null)
        }
    }

    const handleTestSound = async (value: SoundVariant) => {
        if (value === 'off') {
            return
        }
        await playNotificationSound(value)
    }

    const handleRefreshApp = async () => {
        if (isRefreshingApp) return

        setIsRefreshingApp(true)
        try {
            const registration = await navigator.serviceWorker.getRegistration()
            if (registration) {
                await registration.update()
            }
        } catch (error) {
            console.error('[PWA] Failed to check for updates:', error)
        } finally {
            window.location.reload()
        }
    }

    const closeAllSoundMenus = () => {
        setIsReadySoundOpen(false)
        setIsPermissionSoundOpen(false)
        setIsMessageSoundOpen(false)
        setIsFailureSoundOpen(false)
        setIsGeneralSoundOpen(false)
    }

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!isOpen && !isAppearanceOpen && !isFontOpen && !isTerminalFontOpen && !isChatOpen && !isVoiceOpen && !isPlaybackModeOpen && !isReadySoundOpen && !isPermissionSoundOpen && !isMessageSoundOpen && !isFailureSoundOpen && !isGeneralSoundOpen) return

        const handleClickOutside = (event: MouseEvent) => {
            if (isOpen && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
            if (isAppearanceOpen && appearanceContainerRef.current && !appearanceContainerRef.current.contains(event.target as Node)) {
                setIsAppearanceOpen(false)
            }
            if (isFontOpen && fontContainerRef.current && !fontContainerRef.current.contains(event.target as Node)) {
                setIsFontOpen(false)
            }
            if (isTerminalFontOpen && terminalFontContainerRef.current && !terminalFontContainerRef.current.contains(event.target as Node)) {
                setIsTerminalFontOpen(false)
            }
            if (isChatOpen && chatContainerRef.current && !chatContainerRef.current.contains(event.target as Node)) {
                setIsChatOpen(false)
            }
            if (isVoiceOpen && voiceContainerRef.current && !voiceContainerRef.current.contains(event.target as Node)) {
                setIsVoiceOpen(false)
            }
            if (isPlaybackModeOpen && playbackModeContainerRef.current && !playbackModeContainerRef.current.contains(event.target as Node)) {
                setIsPlaybackModeOpen(false)
            }
            if (isReadySoundOpen && readySoundContainerRef.current && !readySoundContainerRef.current.contains(event.target as Node)) {
                setIsReadySoundOpen(false)
            }
            if (isPermissionSoundOpen && permissionSoundContainerRef.current && !permissionSoundContainerRef.current.contains(event.target as Node)) {
                setIsPermissionSoundOpen(false)
            }
            if (isMessageSoundOpen && messageSoundContainerRef.current && !messageSoundContainerRef.current.contains(event.target as Node)) {
                setIsMessageSoundOpen(false)
            }
            if (isFailureSoundOpen && failureSoundContainerRef.current && !failureSoundContainerRef.current.contains(event.target as Node)) {
                setIsFailureSoundOpen(false)
            }
            if (isGeneralSoundOpen && generalSoundContainerRef.current && !generalSoundContainerRef.current.contains(event.target as Node)) {
                setIsGeneralSoundOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen, isAppearanceOpen, isFontOpen, isTerminalFontOpen, isChatOpen, isVoiceOpen, isPlaybackModeOpen, isReadySoundOpen, isPermissionSoundOpen, isMessageSoundOpen, isFailureSoundOpen, isGeneralSoundOpen])

    // Close on escape key
    useEffect(() => {
        if (!isOpen && !isAppearanceOpen && !isFontOpen && !isTerminalFontOpen && !isChatOpen && !isVoiceOpen && !isPlaybackModeOpen && !isReadySoundOpen && !isPermissionSoundOpen && !isMessageSoundOpen && !isFailureSoundOpen && !isGeneralSoundOpen) return

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false)
                setIsAppearanceOpen(false)
                setIsFontOpen(false)
                setIsTerminalFontOpen(false)
                setIsChatOpen(false)
                setIsVoiceOpen(false)
                setIsPlaybackModeOpen(false)
                closeAllSoundMenus()
            }
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isOpen, isAppearanceOpen, isFontOpen, isTerminalFontOpen, isChatOpen, isVoiceOpen, isPlaybackModeOpen, isReadySoundOpen, isPermissionSoundOpen, isMessageSoundOpen, isFailureSoundOpen, isGeneralSoundOpen])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="flex-1 font-semibold">{t('settings.title')}</div>
                </div>
            </div>

            <div className="app-scroll-y flex-1 min-h-0">
                <div className="mx-auto w-full max-w-content">
                    {/* Language section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.language.title')}
                        </div>
                        <div ref={containerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsOpen(!isOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.language.label')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{currentLocale?.nativeLabel}</span>
                                    <ChevronDownIcon className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[160px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.language.title')}
                                >
                                    {locales.map((loc) => {
                                        const isSelected = locale === loc.value
                                        return (
                                            <button
                                                key={loc.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleLocaleChange(loc.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{loc.nativeLabel}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Display section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.display.title')}
                        </div>
                        <div ref={appearanceContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsAppearanceOpen(!isAppearanceOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isAppearanceOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.display.appearance')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentAppearanceLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isAppearanceOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isAppearanceOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[160px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.display.appearance')}
                                >
                                    {appearanceOptions.map((opt) => {
                                        const isSelected = appearance === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleAppearanceChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div ref={fontContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsFontOpen(!isFontOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isFontOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.display.fontSize')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{currentFontScaleLabel}</span>
                                    <ChevronDownIcon className={`transition-transform ${isFontOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isFontOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[140px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.display.fontSize')}
                                >
                                    {fontScaleOptions.map((opt) => {
                                        const isSelected = fontScale === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleFontScaleChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{opt.label}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div ref={terminalFontContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsTerminalFontOpen(!isTerminalFontOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isTerminalFontOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.display.terminalFontSize')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{currentTerminalFontSizeLabel}</span>
                                    <ChevronDownIcon className={`transition-transform ${isTerminalFontOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isTerminalFontOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[140px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.display.terminalFontSize')}
                                >
                                    {terminalFontSizeOptions.map((opt) => {
                                        const isSelected = terminalFontSize === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleTerminalFontSizeChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{opt.label}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Chat section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.chat.title')}
                        </div>
                        <div ref={chatContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsChatOpen(!isChatOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isChatOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.chat.enterBehavior')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentComposerEnterBehaviorLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isChatOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isChatOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[170px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.chat.enterBehavior')}
                                >
                                    {composerEnterBehaviorOptions.map((opt) => {
                                        const isSelected = composerEnterBehavior === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleComposerEnterBehaviorChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Voice Assistant section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.voice.title')}
                        </div>
                        <div ref={voiceContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsVoiceOpen(!isVoiceOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isVoiceOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.voice.language')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>
                                        {currentVoiceLanguage
                                            ? currentVoiceLanguage.code === null
                                                ? t('settings.voice.autoDetect')
                                                : getLanguageDisplayName(currentVoiceLanguage)
                                            : t('settings.voice.autoDetect')}
                                    </span>
                                    <ChevronDownIcon className={`transition-transform ${isVoiceOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isVoiceOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] max-h-[300px] overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg z-50"
                                    role="listbox"
                                    aria-label={t('settings.voice.title')}
                                >
                                    {voiceLanguages.map((lang) => {
                                        const isSelected = voiceLanguage === lang.code
                                        const displayName = lang.code === null
                                            ? t('settings.voice.autoDetect')
                                            : getLanguageDisplayName(lang)
                                        return (
                                            <button
                                                key={lang.code ?? 'auto'}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleVoiceLanguageChange(lang)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{displayName}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sound section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.sound.title')}
                        </div>
                        <div ref={playbackModeContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsPlaybackModeOpen(!isPlaybackModeOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isPlaybackModeOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.playback')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentPlaybackModeLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isPlaybackModeOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isPlaybackModeOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.playback')}
                                >
                                    {playbackModeOptions.map((opt) => {
                                        const isSelected = playbackMode === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handlePlaybackModeChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div ref={readySoundContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsReadySoundOpen(!isReadySoundOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isReadySoundOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.ready')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentReadySoundLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isReadySoundOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isReadySoundOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.ready')}
                                >
                                    {soundVariantOptions.map((opt) => {
                                        const isSelected = readySound === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleReadySoundChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleTestSound(readySound)}
                                disabled={readySound === 'off'}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('settings.sound.testReady')}
                            </button>
                        </div>
                        <div ref={permissionSoundContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsPermissionSoundOpen(!isPermissionSoundOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isPermissionSoundOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.permission')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentPermissionSoundLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isPermissionSoundOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isPermissionSoundOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.permission')}
                                >
                                    {soundVariantOptions.map((opt) => {
                                        const isSelected = permissionSound === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handlePermissionSoundChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleTestSound(permissionSound)}
                                disabled={permissionSound === 'off'}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('settings.sound.testPermission')}
                            </button>
                        </div>
                        <div ref={messageSoundContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsMessageSoundOpen(!isMessageSoundOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isMessageSoundOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.message')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentMessageSoundLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isMessageSoundOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isMessageSoundOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.message')}
                                >
                                    {soundVariantOptions.map((opt) => {
                                        const isSelected = messageSound === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleMessageSoundChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleTestSound(messageSound)}
                                disabled={messageSound === 'off'}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('settings.sound.testMessage')}
                            </button>
                        </div>
                        <div ref={failureSoundContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsFailureSoundOpen(!isFailureSoundOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isFailureSoundOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.failure')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentFailureSoundLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isFailureSoundOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isFailureSoundOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.failure')}
                                >
                                    {soundVariantOptions.map((opt) => {
                                        const isSelected = failureSound === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleFailureSoundChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleTestSound(failureSound)}
                                disabled={failureSound === 'off'}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('settings.sound.testFailure')}
                            </button>
                        </div>
                        <div ref={generalSoundContainerRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsGeneralSoundOpen(!isGeneralSoundOpen)}
                                className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
                                aria-expanded={isGeneralSoundOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="text-[var(--app-fg)]">{t('settings.sound.general')}</span>
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <span>{t(currentGeneralSoundLabel)}</span>
                                    <ChevronDownIcon className={`transition-transform ${isGeneralSoundOpen ? 'rotate-180' : ''}`} />
                                </span>
                            </button>

                            {isGeneralSoundOpen && (
                                <div
                                    className="absolute right-3 top-full mt-1 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg overflow-hidden z-50"
                                    role="listbox"
                                    aria-label={t('settings.sound.general')}
                                >
                                    {soundVariantOptions.map((opt) => {
                                        const isSelected = generalSound === opt.value
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleGeneralSoundChange(opt.value)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-base text-left transition-colors ${
                                                    isSelected
                                                        ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span>{t(opt.labelKey)}</span>
                                                {isSelected && (
                                                    <span className="ml-2 text-[var(--app-link)]">
                                                        <CheckIcon />
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleTestSound(generalSound)}
                                disabled={generalSound === 'off'}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('settings.sound.testGeneral')}
                            </button>
                        </div>
                    </div>

                    {/* Codex model section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.codexModels.title')}
                        </div>
                        <div className="px-3 py-3">
                            <form onSubmit={(event) => void handleAddCustomCodexModel(event)} className="flex flex-col gap-2">
                                <label htmlFor="custom-codex-model-id" className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('settings.codexModels.modelId')}
                                </label>
                                <input
                                    id="custom-codex-model-id"
                                    value={customCodexModelId}
                                    onChange={(event) => setCustomCodexModelId(event.target.value)}
                                    placeholder="gpt-6-astra"
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={!settingsApi || customCodexModelsSaving}
                                    className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-50"
                                />
                                <label htmlFor="custom-codex-model-name" className="text-xs font-medium text-[var(--app-hint)]">
                                    {t('settings.codexModels.displayName')}
                                </label>
                                <input
                                    id="custom-codex-model-name"
                                    value={customCodexModelName}
                                    onChange={(event) => setCustomCodexModelName(event.target.value)}
                                    placeholder={t('settings.codexModels.displayNamePlaceholder')}
                                    autoComplete="off"
                                    disabled={!settingsApi || customCodexModelsSaving}
                                    className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-50"
                                />
                                <fieldset disabled={!settingsApi || customCodexModelsSaving} className="mt-1">
                                    <legend className="mb-2 text-xs font-medium text-[var(--app-hint)]">
                                        {t('settings.codexModels.reasoningEfforts')}
                                    </legend>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                                        {CODEX_REASONING_EFFORT_PRESETS.map((effort) => (
                                            <label
                                                key={effort}
                                                className="flex min-h-8 items-center gap-2 text-sm text-[var(--app-fg)]"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={customCodexReasoningEfforts.includes(effort)}
                                                    onChange={(event) => handleCustomCodexReasoningEffortChange(
                                                        effort,
                                                        event.target.checked
                                                    )}
                                                    className="h-4 w-4 accent-[var(--app-link)]"
                                                />
                                                <span>{CODEX_REASONING_EFFORT_LABELS[effort]}</span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                                <div>
                                    <button
                                        type="submit"
                                        disabled={!settingsApi || customCodexModelsSaving || customCodexModelId.trim().length === 0}
                                        className="rounded-lg bg-[var(--app-link)] px-3 py-2 text-sm text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {customCodexModelsSaving ? t('settings.codexModels.saving') : t('settings.codexModels.add')}
                                    </button>
                                </div>
                            </form>

                            {customCodexModelsError ? (
                                <div className="mt-2 text-sm text-red-600">{customCodexModelsError}</div>
                            ) : null}

                            <div className="mt-3 divide-y divide-[var(--app-divider)] border-y border-[var(--app-divider)]">
                                {customCodexModelsLoading ? (
                                    <div className="py-3 text-sm text-[var(--app-hint)]">{t('settings.codexModels.loading')}</div>
                                ) : customCodexModels.length === 0 ? (
                                    <div className="py-3 text-sm text-[var(--app-hint)]">{t('settings.codexModels.empty')}</div>
                                ) : (
                                    customCodexModels.map((model) => (
                                        <div key={model.id} className="flex items-center gap-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm text-[var(--app-fg)]">
                                                    {model.displayName || model.id}
                                                </div>
                                                {model.displayName ? (
                                                    <div className="truncate text-xs text-[var(--app-hint)]">{model.id}</div>
                                                ) : null}
                                                {model.supportedReasoningEfforts.length > 0 ? (
                                                    <div className="truncate text-xs text-[var(--app-hint)]">
                                                        {t('settings.codexModels.reasoningEfforts')}: {' '}
                                                        {model.supportedReasoningEfforts
                                                            .map((effort) => CODEX_REASONING_EFFORT_LABELS[
                                                                effort as CodexReasoningEffortPreset
                                                            ] ?? effort)
                                                            .join(', ')}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`${t('settings.codexModels.remove')} ${model.displayName || model.id}`}
                                                title={t('settings.codexModels.remove')}
                                                onClick={() => void handleRemoveCustomCodexModel(model)}
                                                disabled={!settingsApi || customCodexModelRemoving !== null}
                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <RemoveIcon />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* About section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.about.title')}
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.website')}</span>
                            <a
                                href="https://hapi.run"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--app-link)] hover:underline"
                            >
                                hapi.run
                            </a>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.appVersion')}</span>
                            <span className="text-[var(--app-hint)]">{__APP_VERSION__}</span>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.protocolVersion')}</span>
                            <span className="text-[var(--app-hint)]">{PROTOCOL_VERSION}</span>
                        </div>
                        <div className="px-3 pb-3">
                            <button
                                type="button"
                                onClick={() => void handleRefreshApp()}
                                disabled={isRefreshingApp}
                                className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isRefreshingApp ? t('settings.about.refreshing') : t('settings.about.refresh')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
