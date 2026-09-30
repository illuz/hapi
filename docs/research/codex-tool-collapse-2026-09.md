# Codex 工具调用折叠方案研究

> 研究日期：2026-09-30（Asia/Shanghai）  
> 当前基线：`main`（`05897bfe`）  
> 上游快照：`upstream-snapshot-2026-09-29`（`86c88df9`）  
> 范围：Web 工具调用、Codex 探索活动、Reasoning 与终端输出的展示密度。

## 1. 结论

上游新版本确实会把工具调用折叠起来，但不是简单地把每张卡片套一层 `details`：

1. 连续的普通执行工具调用（Read、Grep、Bash、Edit、Write 等）合并为一个 `ToolGroupCard`，默认收起。
2. 收起状态只显示“检查文件 / 搜索内容 / 执行命令”等目标导向摘要；展开后显示紧凑行，点击某一行才打开完整输入、Trace 和结果详情。
3. Codex 的读取/搜索活动有专门的 `codex-exploration` 分组，即使只有一个 `CodexBash` 调用也可以折叠；行内容来自 Codex 原生的 `command_actions`。
4. 权限请求、用户提问、子 Agent、计划/里程碑类工具不会被吞进普通分组，继续单独显示。
5. Reasoning 和终端输出另有独立的降噪策略：Reasoning 可设置默认折叠，终端工具卡默认只显示命令，输出放到详情中。

## 2. 当前分支为何仍然显得“中间过程太多”

### 2.1 运行中的工具组会被强制展开

当前 `web/src/components/AssistantChat/messages/ToolMessage.tsx:18-71` 的本地 `ToolGroupCard` 使用：

```tsx
open={props.group.defaultOpen || isLive}
```

只要组内存在 `running` / `pending` 工具，整个组就会自动展开。上游原始分组方案明确要求“运行中、错误状态也不自动展开”，只在标题上显示状态和计时。

### 2.2 展开后的每一行仍然是完整 ToolCard

当前分组内部直接渲染 `ToolCard`（包含输入和结果预览），因此一个组展开后仍然会产生大量中间内容。上游 `ToolGroupCard` 使用紧凑行列表，详情通过单独 Dialog 打开，不把大块 payload 放在时间线里。

### 2.3 Codex 原生探索信息没有传到 Web

当前 `cli/src/codex/codexRemoteLauncher.ts:661-694` 发送 `CodexBash` 时主要保留命令和通用事件字段；当前 `appServerEventConverter` 也没有保留 `command_actions` / `command_source`。

上游提交 `aa5beb3a` 增加了这些字段：

- `command_actions`：把一次命令拆成 Read / List / Search 等用户可读动作；
- `command_source`：区分 Agent 探索和用户主动执行；
- `duration_ms`、`aggregated_output`：补齐工具时序和最终输出。

没有这些元数据时，Web 无法识别“Codex 探索活动”，单个 `CodexBash` 只能按普通工具卡显示。

### 2.4 Reasoning 流式时会自动展开

当前 `web/src/components/assistant-ui/reasoning.tsx:54-66` 在流式 Reasoning 时执行 `setIsOpen(true)`，且没有持久化偏好。上游 `e532ff25` 增加 `useReasoningCollapse`，允许用户设置“思考默认折叠”，流式期间也不强制展开。

## 3. 上游 Codex 方案的关键实现

| 能力 | 上游实现 | 当前分支 | 关键提交 |
| --- | --- | --- | --- |
| 普通工具连续分组 | `toolGroups.ts` + `ToolGroupCard.tsx` | 有基础分组，但卡片内仍渲染完整 ToolCard | `af3491e0` |
| 目标导向标题 | 根据文件、搜索词、命令推导摘要 | 当前仅显示“读取/搜索/命令”计数 | `60af9835`、`e69ca078`、`f31c591f` |
| Codex 探索分组 | `isCodexExplorationTool` + `command_actions` 行 | 缺失 | `aa5beb3a` |
| 工具耗时/状态 | 组级 Started / Finished / Duration 和状态 Badge | 仅单工具有有限状态信息 | `d90bde0b` |
| Codex 探索默认收起 | `DEFAULT_CODEX_EXPLORATION_COLLAPSED = true`，可在设置中修改 | 缺失 | `d0ae6c1f` |
| 终端卡片降噪 | `compact`（默认）/ `detailed` 设置；默认不显示输出预览 | 缺失 | `3a6574f2` |
| Reasoning 降噪 | `useReasoningCollapse`，跨标签页同步并持久化 | 流式时自动展开 | `e532ff25` |
| 历史边界处理 | 最老可见分组展开时自动补加载旧页并保持滚动锚点 | 当前 Context 未向分组卡暴露加载器 | `af3491e0`、`584d1647` |

上游的分组计划还明确了两个边界：只改 Web 可见投影，不改变 Hub 消息 API；交互工具（权限、提问）是硬边界，不进入普通工具组。

## 4. 推荐迁移路径

### P0：立即降低噪声（S）

1. 去掉当前 `isLive` 对分组 `open` 的强制展开；运行中只显示标题、Spinner、计时。
2. 将终端工具默认改为 compact，只在详情 Dialog 展示 stdout/stderr。
3. 增加 Reasoning 默认折叠开关，保留用户手动展开能力。

这部分不需要 Hub 改动，也不改变消息协议。

### P1：移植 Codex 专用展示（M）

1. 新增 `web/src/chat/codexCommandPresentation.ts`，解析 `command_actions`。
2. 将 `ToolGroupCard` 从 `ToolMessage.tsx` 拆成独立组件，改为“摘要标题 + 紧凑行 + 详情 Dialog”。
3. 扩展 `toolGroups.ts` 的 grouping family，允许单个 Codex exploration 工具形成折叠组。
4. CLI 的 Codex converter 保留 `command_actions`、`command_source`、`duration_ms`；Hub 不需要新增字段，现有消息内容是 `unknown`，可透明传递。

### P2：补齐历史和响应聚合（M/L）

1. 将 `HappyThread` 的滚动保持型旧消息加载器通过 Context 暴露给 `ToolGroupCard`。
2. 最老可见分组展开时自动补页，避免分组边界被分页截断。
3. 参考上游 `visibleBlockRole` 和响应聚合逻辑，减少连续 assistant block 的视觉碎片；不要替换当前 Tail Sync 状态机。

## 5. 风险与难度

- **纯 Web 降噪：S/M。** 不涉及 Hub，适合先做。
- **Codex exploration：M。** 需要 CLI 事件元数据和 Web 展示同时改，必须保留用户主动执行命令的独立语义。
- **历史自动补页：M/L。** 主要风险是与当前 Tail Sync、滚动锚点和旧消息分页交互。
- **不建议直接整体合并上游 `SessionChat.tsx` / `HappyThread.tsx`。** 当前分支已有本地 AUTO、Retry、Tail Sync、消息窗口和会话操作逻辑，应抽取上述小模块逐项回迁。

## 6. 验证结论

- 上游 `ToolGroupCard` 测试覆盖了：默认收起、运行中计时、紧凑行、详情 Dialog、Codex exploration 行、分页补历史。
- 当前分支只覆盖基础连续工具分组和排除交互工具，尚未覆盖上述 Codex 专用场景。
- 这项展示优化与之前的 Rewind/Steer 不同：**不需要 Hub API 或数据库变更**；真正需要跨端同步的是 Codex 的工具事件元数据，而不是折叠状态本身。
