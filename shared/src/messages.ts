import { AGENT_MESSAGE_PAYLOAD_TYPE } from './modes'
import { isObject } from './utils'

type RoleWrappedRecord = {
    role: string
    content: unknown
    meta?: unknown
}

const VISIBLE_CLAUDE_SYSTEM_SUBTYPES = new Set([
    'api_error',
    'turn_duration',
    'microcompact_boundary',
    'compact_boundary'
])

export function isRoleWrappedRecord(value: unknown): value is RoleWrappedRecord {
    if (!isObject(value)) return false
    return typeof value.role === 'string' && 'content' in value
}

export function unwrapRoleWrappedRecordEnvelope(value: unknown): RoleWrappedRecord | null {
    if (isRoleWrappedRecord(value)) return value
    if (!isObject(value)) return null

    const direct = value.message
    if (isRoleWrappedRecord(direct)) return direct

    const data = value.data
    if (isObject(data) && isRoleWrappedRecord(data.message)) return data.message as RoleWrappedRecord

    const payload = value.payload
    if (isObject(payload) && isRoleWrappedRecord(payload.message)) return payload.message as RoleWrappedRecord

    return null
}

/** 只按来源识别自动续跑，不能把用户手动输入的 continue 一并隐藏。 */
export function isAutomaticContinuationMeta(meta: unknown): boolean {
    return isObject(meta) && (meta.sentFrom === 'auto-continue' || meta.sentFrom === 'auto-retry')
}

export function isClaudeChatVisibleSystemSubtype(subtype: unknown): subtype is string {
    return typeof subtype === 'string' && VISIBLE_CLAUDE_SYSTEM_SUBTYPES.has(subtype)
}

export function isClaudeChatVisibleMessage(message: { type: unknown; subtype?: unknown }): boolean {
    if (message.type === 'rate_limit_event') {
        return false
    }

    if (message.type !== 'system') {
        return true
    }

    return isClaudeChatVisibleSystemSubtype(message.subtype)
}

/** 读取 ACP 思考流标识；liveOnly=true 时只匹配可被后续快照替换的记录。 */
function readReasoningStreamId(value: unknown, liveOnly: boolean): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(value)
    if (record?.role !== 'agent') return null

    const content = record.content
    if (!isObject(content) || content.type !== AGENT_MESSAGE_PAYLOAD_TYPE) return null

    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'reasoning') return null
    if (liveOnly && data.live !== true) return null

    const id = data.id
    return typeof id === 'string' && id.trim().length > 0 ? id : null
}

/** 返回思考流标识，包括已结束的最终记录。 */
export function getReasoningStreamId(value: unknown): string | null {
    return readReasoningStreamId(value, false)
}

/** 仅返回仍可被新快照替换的思考流标识。 */
export function getLiveReasoningStreamId(value: unknown): string | null {
    return readReasoningStreamId(value, true)
}

export type { RoleWrappedRecord }
