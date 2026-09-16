import type { CodexModelSummary, CustomCodexModel } from '@/types/api'

export type CodexModelOption = {
    value: string
    label: string
    supportedReasoningEfforts?: string[]
}

export function mergeCodexModelOptions(
    discoveredModels: CodexModelSummary[],
    customModels: CustomCodexModel[]
): CodexModelOption[] {
    const options: CodexModelOption[] = []
    const seen = new Set<string>()

    for (const model of [...discoveredModels, ...customModels]) {
        const id = model.id.trim()
        if (!id || seen.has(id)) {
            continue
        }
        seen.add(id)
        options.push({
            value: id,
            label: model.displayName?.trim() || id,
            supportedReasoningEfforts: model.supportedReasoningEfforts?.length
                ? [...model.supportedReasoningEfforts]
                : undefined
        })
    }

    return options
}
