# 会话 Web UI 与 KaTeX 差异研究

> 研究日期：2026-09-29（Asia/Shanghai）  
> 当前基线：`main`（`41be39a7`）  
> 上游快照：`upstream-snapshot-2026-09-29`（`86c88df9`）  
> 研究范围：会话 Web UI、Markdown/KaTeX 渲染、可选择 backport 的特性。

## 1. KaTeX 问题定位与修复

### 1.1 根因

- Markdown 解析链其实已经存在：`web/src/components/assistant-ui/markdown-text.tsx:11-25` 同时注册了 `remark-math` 与 `rehype-katex`。
- 全局样式在 `web/src/index.css:2` 引入 `katex/dist/katex.min.css`。该 CSS 使用相对路径 `fonts/KaTeX_*.{woff2,woff,ttf}`。
- 修复前生产构建没有输出 `web/dist/assets/fonts`，构建日志对 60 个字体 URL 报 “didn't resolve at build time”；因此页面可能生成 `.katex` DOM，但浏览器找不到字体，出现空白、回退字体或错位。
- 上游提交 `a8152308` 在 `web/vite.config.ts` 增加 `copyKaTeXFonts()`，这是当前分支缺失的关键差异；上游仍保留同一份 KaTeX CSS 导入。

### 1.2 当前实现

- `web/src/lib/katex-font-assets.ts:13-21` 通过 `require.resolve('katex')` 定位 workspace root hoist 后的包，收集 `ttf/woff/woff2` 三种格式。
- `web/vite.config.ts:44-58` 在 production `generateBundle` 阶段把文件写入 `assets/fonts/`；生成 CSS 的相对 URL 会解析到同一目录。
- PWA 的 `globPatterns` 已包含 `woff/woff2`（`web/vite.config.ts:118`），Hub embedded asset generator 也已声明三种字体 MIME（`hub/scripts/generate-embedded-web-assets.ts:16-25`），因此单文件部署链路会继续携带字体。
- 同步补上游 bracket math 解析：`remarkLatexBracketMath` 支持 `\( ... \)` / `\[ ... \]`，并加入 GFM 短分隔行修复；保留当前 single-dollar math 兼容行为，暂未采用上游的 `singleDollarTextMath: false`。
- 新增回归测试：`web/src/lib/katex-font-assets.test.ts`、`web/src/components/MarkdownRenderer.test.tsx`。

### 1.3 验证

| 检查 | 结果 |
| --- | --- |
| `bun run test:web` | 86 个文件、552 个测试通过 |
| `bun run typecheck:web` | 通过 |
| `bun run build:web` | 通过，输出 60 个 KaTeX 字体文件 |
| Hub embedded assets | `/assets/fonts/KaTeX_Main-Regular.woff2` 被收录，MIME 为 `font/woff2` |
| Headless Chromium smoke | CSS 与字体请求均成功，`document.fonts.check('16px KaTeX_Main') === true` |

这次修复同时解决字体打包/部署和常见 bracket delimiter 未解析的问题；已有 `$...$`、`$$...$$` 解析规则保持不变。

说明：Vite 在 CSS transform 阶段仍可能打印相对字体 URL 的 informational warning；字体由 `generateBundle` 正式输出，产物检查和浏览器 smoke 已确认运行时 URL 可用。若未来 CI 把 warning 视为错误，再单独做 CSS URL 重写，当前不应因此回退字体资产。

## 2. 当前会话 UI 与上游差异

| 区域 | 当前项目 | 上游会话 UI | 评估 |
| --- | --- | --- | --- |
| 会话外壳/顶部栏 | `SessionHeader` 已有 AUTO Continue/Retry、历史/大纲、分享、Pin、文件入口 | 增加文件/大纲/终端切换态、Inactive reopen、Codex/Pi 手动同步、模型/推理/ Fast badge、标题建议、attention/unread 状态 | 上游交互更完整，但与本地 AUTO、Pin 语义有重叠；适合拆分移植（M） |
| 消息窗口 | 当前已完成增量 Tail Sync，支持 tail/history、旧消息加载、seq 定位（`message-window-store.ts`） | 在此基础上增加取消/失效、冷会话小页刷新、runtime/history 版本校验、rewind 后保持可视锚点、unseen block 计数 | 与本地 Tail Sync 直接相关；优先移植健壮性补丁，不要覆盖本地状态机（M） |
| Thread / 历史操作 | 有 Conversation Outline、历史面板、按条目 Fork | 增加消息级 Fork/Rewind、失败时 Fork fallback、搜索大纲、分享本轮、滚动自动暂停/恢复 | 需要 Hub API、消息窗口和 UI 同时改动；不是纯视觉合并（L） |
| Composer | 文本/附件、权限/模型/effort、语音、AUTO、快捷提示 | 增加队列/Steer、定时发送、附件拖拽排序、草稿/失败恢复、多 Provider 模型、Dictation、Scratchlist 停放 | 依赖新的消息 delivery 协议；Steer/定时发送为 L，Scratchlist 为 XL |
| Assistant / Tool 消息 | Markdown、Reasoning、单工具卡、复制 | MessageActions（复制/分享/Fork/Rewind）、Steered 标记、连续工具分组、Codex Review Card、生成媒体预览、路径链接策略 | 工具分组单独已有上游提交 `af3491e0`，约 13 个文件、约 1.5k 行（M/L） |
| Markdown | 已有 `remark-gfm`、CJK autolink、表格修复、bracket math、`remark-math`、禁用缩进代码；支持 `$`/`$$`/`\(`/`\[` | 上游在此基础上增加 hard breaks、session/file path links；并关闭 single-dollar math 以避免 `$200` 被误解析 | 当前高风险部分已回迁；剩余链接策略与 single-dollar 语义为 M |
| Session List | 项目/机器分组、加权搜索、Pin、颜色/日期/活跃筛选、Project Tools/Ports 入口 | 增加 running/pending 分桶、全局/项目 Pin、Unread/Attention、机器健康、日历筛选、标题建议、share-target 搜索 | 价值高但会碰当前筛选与 Pin 数据模型；按“Unread/机器健康/日历”拆分（M） |
| 路由与跨端 | Web/PWA、文件/终端/管理/分享等本地路由 | 增加 share target、superseding session 跟随、更多 Agent/原生端协议入口 | 依赖上游 API/protocol；不建议随会话组件整体合并（L/XL） |

## 3. 推荐合并顺序

难度定义：S = 半天至 1 天；M = 1–5 天；L = 1–2 周；XL = 需要专项里程碑。

1. **P0（已完成，S）：KaTeX 字体打包 + bracket math。** 保留当前实现与回归测试；不要直接复制上游 `__dirname/node_modules` 路径，因为本仓库是 Bun workspace，`katex` 位于 root `node_modules`。
2. **P1（M）：Markdown 语义补齐。** 评估上游的 `singleDollarTextMath: false`、hard breaks、session/file path links；先处理 `$` 兼容和安全策略，再接入两条 Markdown 渲染路径。
3. **P1（M）：Tail Sync 健壮性。** 从上游 `7b6c5755`、`c258a227`、`17ee052d` 抽取缓存刷新、版本校验、滚动锚点和 rewind 保护；保留本地 AUTO/Retry 与既有 `syncTailMessages` API。
4. **P1（M/L）：消息级操作与 Tool Group。** 先移植纯 Web 的 `MessageActions`、连续工具分组和 Codex Review 展示，再评估 Hub 侧 Steer/Queued API。
5. **P2（M）：会话列表 Unread/Attention、机器健康、日历筛选。** 与当前搜索排序、颜色/日期筛选合并，避免替换已有 `SessionList`。
6. **P2（L）：Steer、定时发送、多 Provider Composer。** 必须按 CLI → Hub → shared protocol → Web 顺序迁移并做事件顺序回放。
7. **P3（XL）：Scratchlist、Shared Sessions、原生端/Relay。** 这些是跨存储、协议和客户端的产品线能力，不应作为会话 UI 小改动合入。

## 4. 本轮 1~5 实施结果

按上述顺序完成了前 5 项的可回迁部分：

- **1 / KaTeX**：字体产物复制、嵌入式资源 MIME、支持 `\(...\)` / `\[...\]` bracket math，保留回归测试（`8151f1ce`）。
- **2 / Markdown**：关闭 `remark-math` 的默认 single-dollar 解析，再通过安全插件兼容明确的 `$...$`；补 hard breaks、仓库文件路径链接与文件链接行为（`0e83444a`）。
- **3 / Tail Sync**：冷启动小页、缓存重入拉取最新尾部、版本/历史变更触发滚动恢复，避免旧游标覆盖新状态（`17af1c9f`）。
- **4 / 消息操作与工具展示**：新增复制/分享/消息级 Fork；连续普通工具调用折叠为 Tool Group；增加 Codex Review JSON 的结构化卡片。补齐 Hub 侧 Rewind、Steer、Queued State REST API、CLI RPC 网关、消息截断与 epoch 失效广播；当前分支的 Claude/Codex 等 CLI 尚未提供原生 Rewind/Steer handler，Hub 会返回结构化“不支持”结果，不会只改 Hub transcript 造成双端分叉。
- **5 / 会话列表**：增加本地 last-seen 未读水位及“只看未读”过滤、机器在线/启动/异常/离线指示、按本地日历日期过滤；不替换现有搜索、颜色筛选、项目工具入口和 Pin 语义。

验证：`bun run typecheck` 通过；Web 全量测试 93 个文件、571 个测试通过。根目录完整测试仍有既有的 CLI Darwin/Windows 模拟测试失败（与本轮变更无关）。

## 5. 不建议的合并方式

- 不建议直接 `git merge upstream/main`：共同祖先较早，核心会话、消息窗口、Socket、Agent 和部署文件均已分叉；既有差异报告的模拟合并已记录 151 个真实冲突路径。
- 不要覆盖当前的 AUTO Continue/Retry、Project Tools/Cron、Port Mapping、Docker/自部署认证和本地会话筛选；这些是当前产品差异化能力。
- 对上游 Web 提交优先采用“算法/纯组件 + 测试”拆分 backport，避免一次替换 `SessionChat.tsx`、`HappyThread.tsx`、`HappyComposer.tsx` 三个核心入口。
