import { useCallback, type ReactNode } from 'react'
import { useAssistantApi } from '@assistant-ui/react'
import { CodexFollowupProvider } from '@/components/assistant-ui/codex-directive'

export function AssistantFollowupProvider(props: { disabled: boolean; children: ReactNode }) {
    const api = useAssistantApi()
    const onInsertPrompt = useCallback((prompt: string) => {
        if (props.disabled) return
        const composer = api.composer()
        const current = composer.getState().text
        // 追加而非覆盖现有草稿；不调用 send，保留用户检查和编辑的机会。
        composer.setText(current ? current + '\n\n' + prompt : prompt)
    }, [api, props.disabled])

    return (
        <CodexFollowupProvider onInsertPrompt={props.disabled ? undefined : onInsertPrompt}>
            {props.children}
        </CodexFollowupProvider>
    )
}
