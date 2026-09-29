# HAPI 上游差异与合并评估

> 研究日期：2026-09-29（Asia/Shanghai）  
> 研究对象：当前仓库 illuz/hapi（本地 main）与上游 tiann/hapi（upstream/main）  
> 研究目标：识别产品与架构差异，筛选值得合并的上游特性，并估算合并难度。

## 1. 结论摘要

1. **当前仓库已经是独立产品分支，不是只落后几个提交的轻量 fork。** 上游近几个月转向多 Agent、Codex app-server、原生 iOS/Android、Relay 和移动推送；当前分支重点投入 AUTO Continue/Retry、Project Agent/Cron、端口映射、Docker 部署以及会话管理。参见[上游 README](https://github.com/tiann/hapi)与[当前 fork README](https://github.com/illuz/hapi)。
2. **不建议直接执行 git merge upstream/main。** 本地 merge-tree 模拟得到 151 个唯一真实冲突路径，其中 web 67、cli 47、hub 26、shared 7；冲突集中在会话、同步、消息、Socket、Agent 和 Web 页面等核心文件。
3. **优先采用选择性 backport（反向移植），而不是整体合并。** 第一批建议：SSE gzip 压缩、可靠性修复、搜索排序；第二批再评估 Prepared Statement Cache、内容编解码、可配置 MCP。Codex Shared Sessions、Steer、增量历史同步以及原生移动端属于架构级项目，应单独立项。
4. **如果战略目标是原生移动端，建议反向迁移。** 从上游新建 upstream-native 分支，再逐项移植当前的 Docker、AUTO、Project Tools/Cron、Port Mapping；在当前分支上硬接上游 869 个独有提交，成本和回归风险更高。

## 2. 研究口径与基线

### 2.1 Git 拓扑

| 项目 | 值 | 说明 |
| --- | --- | --- |
| 当前 HEAD | 0d4ef749 | 2026-09-28，DOCKER；相对 origin/main 领先 1 个提交 |
| 上游 HEAD | 86c88df9 | 2026-09-25，cross-platform orphan reap |
| 最近共同祖先 | 0006d04f | 2026-05-07，support multiple workspace roots |
| 上次显式上游合并 | 35f2607f | 2026-05-07，合并 tiann/hapi 并保留本地自动接管改动；见[合并提交](https://github.com/illuz/hapi/commit/35f2607fd6270fe90c467519056293bddf88a9f) |
| 提交数量（HEAD...upstream/main） | 116 / 869 | 左侧为当前分支独有，右侧为上游独有 |
| 文件变化 | 2713 个文件，+458680/-54004 | git diff --shortstat HEAD..upstream/main |
| 模拟合并冲突 | 151 个真实路径 | git merge-tree --write-tree，未修改工作树 |

### 2.3 本次执行快照

已完成路线 A 的第 1 步：

| 引用 | 指向 |
| --- | --- |
| `current-product-2026-09-29` | 执行前的 `0d4ef749`，用于回滚和对比 |
| `upstream-snapshot-2026-09-29` | `upstream/main` 的 `86c88df9`，仅作只读上游快照 |

当前 `main` 没有直接 merge 上游，所有 backport 都是独立提交。

当前 fork 的公开仓库明确标注为 fork；这与本地共同祖先和上次合并提交相互印证。[fork 仓库](https://github.com/illuz/hapi)；[上次合并提交](https://github.com/illuz/hapi/commit/35f2607fd6270fe90c467519056293bddf88a9f)。

### 2.2 目录与运行时差异

| 维度 | 当前分支 | 上游主线 | 合并含义 |
| --- | --- | --- | --- |
| Agent 面 | Claude、Codex、Gemini、OpenCode | 继续扩展 Copilot、Kimi、Pi、Grok、Antigravity、DeepSeek Harness 等 | 共享 Agent 工厂、权限和会话协议变化大 |
| 客户端 | Web/PWA、Telegram | 在此基础上新增 Android、iOS、Relay、推送 | 新增大量独立目录和 protocol fixtures，不适合逐文件合并 |
| Hub | SQLite、Socket.IO、SSE、Telegram | 增加 app-server 同步、Tail Sync、压缩、content codec、Prepared Statement Cache | hub/src/sync、store、socket 是主要冲突面 |
| Web | 自定义会话管理、筛选、AUTO、Project Tools、端口面板 | 重做历史窗口、搜索、Codex 控制、原生协议联动 | 视觉层和 data hooks 同时冲突 |
| CLI | 后端接管、Codex models、项目工具与端口代理 | 扩展 ACP、app-server、跨平台 runner 和多 Agent | CLI 协议与 Hub 事件必须成对移植 |
| 部署 | 保留 Dockerfile、docker、自部署认证与多 Hub 文档 | 主线已删除这些 Docker 文件，转向 npx ... hub --relay 等路径 | 盲目采用上游会丢失当前生产部署能力 |
| 包与脚本 | @illuz-modified/hapi，工作区较少 | @twsxtd/hapi、Bun 版本约束、relay、e2e/integration 脚本 | 包名、锁文件、发布流程不能直接覆盖 |

上游 README 将原生 Android/iOS、Relay、语音、Workspace Browser 和多 Agent 列为产品能力；当前 README 仍以 Web/PWA、Telegram、Docker 和主要 Agent 为主。[上游产品说明](https://github.com/tiann/hapi#readme)；[当前产品说明](https://github.com/illuz/hapi#readme)。

## 3. 当前分支值得保留的差异化能力

这些能力在上游当前代码中没有对应实现，或语义不同；合并时应视为必须保留的产品资产。

| 能力 | 本地证据 | 产品价值 | 与上游冲突 |
| --- | --- | --- | --- |
| AUTO Continue / AUTO Retry / overload recovery | hub/src/sync/autoContinueService.ts、autoRetryService.ts、shared/src/autoContinue.ts；代表提交：[AUTO 后端接管](https://github.com/illuz/hapi/commit/32b06c2f)、[全局 AUTO](https://github.com/illuz/hapi/commit/577e5173) | 长任务无人值守、过载自动恢复 | 高；触及消息状态、权限和重试队列 |
| Project Agent 与 Cron | hub/src/sync/projectToolsService.ts、cronScheduler.ts、CLI projectTools；代表提交：[Project Agent/Cron](https://github.com/illuz/hapi/commit/a63f1f98) | 把项目运维动作纳入 Agent 工作流 | 高；上游 MCP/Agent 协议变动会影响工具注册 |
| Port Mapping / 静态站点代理 | hub/src/sync/portMappingService.ts、shared/src/portMappings.ts、CLI portProxy；代表提交：[Port Mapping](https://github.com/illuz/hapi/commit/68dbd6e2) | 远程预览开发服务器、静态站点 | 中；服务可独立保留，Web 面板会冲突 |
| Docker 与自部署 | Dockerfile、docker、自部署认证；代表提交：[deployment](https://github.com/illuz/hapi/commit/0814b3a0)、[当前 Docker 更新](https://github.com/illuz/hapi/commit/0d4ef749) | 私有化、内网和多 Hub 部署 | 上游删除 Docker 文件，直接合并有回退风险 |
| 会话管理增强 | Pin、日期/颜色筛选、历史面板、Claude fork、分享/标记等 | 运营大量会话时提升可检索性 | 高；上游已有另一套 project/global pin 与搜索模型 |

## 4. 上游特性评估

以下难度是基于冲突模拟、改动范围和依赖关系的工程估算，不是上游官方承诺：S 约半天至 1 天，M 1–5 天，L 1–2 周，XL 2–8 周以上；还需加回归测试和发布窗口。

### 4.1 建议近期合并

| 优先级 | 上游特性 | 证据与收益 | 模拟冲突/难度 | 建议做法 |
| --- | --- | --- | --- | --- |
| P0 | SSE gzip 压缩 | [8e261a1f](https://github.com/tiann/hapi/commit/8e261a1f) 在 SSE 路径加入压缩和 Z_SYNC_FLUSH；提交描述报告约 72–77% 传输下降，同时保持事件即时送达 | 0；S | 直接 cherry-pick；保留当前 SSE 事件格式，补 Hub SSE 测试和浏览器 smoke test |
| P0 | Codex/Runner orphan reap | [86c88df9](https://github.com/tiann/hapi/commit/86c88df9) 修复归档或跟踪丢失后的跨平台孤儿进程回收 | 57；L | 不要整提交；抽取进程树发现/回收逻辑，先在当前 runner 写平台测试，再接 AUTO 的取消/重试状态 |
| P0 | 活跃 Codex 历史同步保护 | [b6849c1d](https://github.com/tiann/hapi/commit/b6849c1d) 防止活动会话 transcript 回写覆盖实时状态 | 不适用；待专项 | 当前基线没有 `codexDesktop` transcript-import 路由；CLI 本地 launcher 已对 primary session/transcript 做过滤，因此本次不引入上游整套路由 |
| P1 | 搜索排序（weighted/IDF） | [b6d0fa56](https://github.com/tiann/hapi/commit/b6d0fa56) 为会话搜索增加权重和 IDF 排序 | 1；M | 把排序算法接入当前 SessionList，保留本地 Pin、日期和颜色筛选；不要覆盖当前查询 API |
| P1 | 取消权限请求的状态修复 | [6c69e2f3](https://github.com/tiann/hapi/commit/6c69e2f3) 处理权限请求取消后的状态一致性 | 4；M | 先确认本地权限事件名，再移植 reducer/测试；对 AUTO Retry 尤其重要 |

### 4.2 有价值但需要专项设计

| 特性 | 上游证据 | 价值 | 主要风险 | 估算 |
| --- | --- | --- | --- | --- |
| Prepared Statement Cache | [d14683a4](https://github.com/tiann/hapi/commit/d14683a4) 涉及 Hub store、Socket 和 session invalidation | 降低 SQLite 高频读写开销 | 当前 store 有自定义 AUTO、Pin、分享表和迁移；直接覆盖会破坏缓存失效语义 | L，3–7 天 |
| 增量 Tail Sync | [faf70c64](https://github.com/tiann/hapi/commit/faf70c64) 同时改 Hub store/sync 与 Web 消息窗口 | 长会话首屏和追尾更新更快 | 已按本地消息窗口和历史 API 适配；仍需关注旧客户端兼容与高并发回归 | 已实现；M，约 3–5 天 |
| Content Codec（截断 + zstd） | [05ba050e](https://github.com/tiann/hapi/commit/05ba050e) 描述大消息压缩与截断，提交含 schema/fixtures | 降低 SQLite 和网络占用 | 需要迁移、备份、旧消息读取和大消息回放测试 | L，1–2 周 |
| 用户配置 MCP Servers | [5c5c8b3a](https://github.com/tiann/hapi/commit/5c5c8b3a) 增加 HAPI-owned MCP proxy、Windows shim 和配置持久化 | 与当前 Project Tools 组合，扩展用户工具 | 两套 MCP bridge、命令白名单和 Windows 路径安全规则需统一 | L，1–2 周 |
| Kimi / Pi / Copilot 等 Agent | [Kimi](https://github.com/tiann/hapi/commit/763f45ac)、[Pi](https://github.com/tiann/hapi/commit/e23ae1b2)、[Copilot ACP](https://github.com/tiann/hapi/commit/f10fbc74) | 扩大模型和供应商范围 | 每个 Agent 都牵涉 flavor、权限、resume、模型列表、CLI/Hub/Web 三端；逐个模拟冲突约 9–63 个 | 单 Agent L；按需求排序 |

### 4.3 暂不建议在当前主线上合并

| 特性 | 上游证据 | 为什么暂缓 |
| --- | --- | --- |
| Codex Shared Sessions | [0c4abcb3](https://github.com/tiann/hapi/commit/0c4abcb3) 把一个 app-server 会话同步到原生、CLI、Web、手机，并加入队列、权限、问题历史和 steering | 共享运行时协议重构；与本地 AUTO、Codex models、会话状态机重叠，模拟约 73 个冲突 |
| Mid-turn Codex Steer | [f0e5ba9c](https://github.com/tiann/hapi/commit/f0e5ba9c) 加入 capability gate、queue reservation 和 turn/steer | 依赖 Shared Sessions 和新的 CLI/Hub 事件协议；模拟约 74 个冲突 |
| 原生 Android/iOS + Relay + APNs | [Android scaffold](https://github.com/tiann/hapi/commit/3885f65)、[iOS push](https://github.com/tiann/hapi/commit/2f8e699f)、[官方 Relay](https://github.com/tiann/hapi/commit/0c0c0caf)、[Hub push channel](https://github.com/tiann/hapi/commit/25f63717) | 新增数百个原生文件、协议 fixtures、加密推送和发布链路；这是产品线迁移，XL/epic |
| 大批 Agent 一次性合并 | [Grok](https://github.com/tiann/hapi/commit/b9eed7c0)、[Antigravity](https://github.com/tiann/hapi/commit/e35c06b3)、[DeepSeek Harness](https://github.com/tiann/hapi/commit/be1ef2a2) | 变更量达到数十至上百文件；没有明确用户需求时，维护成本高于收益 |

## 5. 推荐路线

### 路线 A：当前产品继续演进（推荐）

适用于需要保留 AUTO、Project Tools/Cron、Port Mapping 和 Docker 的团队。

1. 打 current-product-2026-09 tag，并创建 upstream-snapshot-2026-09 分支；禁止在 main 上直接 merge 上游。
2. 先移植 P0：SSE gzip、活跃历史 guard、取消权限状态；每个特性一个 PR，保留本地 API 和数据库表。
3. 再移植搜索排序；之后单独评审 Prepared Statement Cache、Content Codec、MCP。
4. 每次只引入一个 Agent（优先 Kimi 或 Pi，取决于用户需求），通过共享 flavor/session factory 接入，不复制上游整套 Web 页面。
5. 对 Shared Sessions、Steer 建立独立 RFC；Tail Sync 已按本地协议完成选择性迁移，后续只需跟踪上游兼容性修复。

### 路线 A 执行结果（2026-09-29）

已完成：

- SSE gzip：`8ee43fd7`，保留 Hono SSE 事件格式，新增 backpressure、取消和 `q=0` 测试。
- 搜索相关性：`5beeb27` + `2f116c2`，移植 field weight、boundary bonus、IDF，并接入当前自定义 SessionList；保留 Pin、日期和颜色筛选。
- 权限取消：`e82bff9`，取消请求会写入 `completedRequests`，迟到应答返回 HTTP 409；新增共享 RPC 错误常量和 route/CLI 测试。

未直接移植：

- 上游活跃 Codex history guard 依赖当前分支不存在的 `codexDesktop` transcript-import 路由。当前 CLI 的 `codexLocalLauncher` 已拒绝非 primary transcript/session，继续引入上游路由会扩大合并面，因此留待 Codex history/import 专项。

### 增量 Tail Sync 迁移结果（2026-09-29）

本次已完成上游 `faf70c64` 的选择性迁移，未覆盖上游整套 Web 页面：

- **Hub / SQLite**：Schema 升至 v20，新增 `message_epochs`；消息读取支持 `(position_at, seq)` 复合游标、`after` 增量页、`until` 固定快照头和 epoch reset。
- **一致性保护**：队列删除、会话复制/合并、可能改变显示顺序的 late invocation 会递增 epoch；客户端发现 epoch 不一致时用最新页替换陈旧窗口。
- **REST / Client**：`GET /api/sessions/:id/messages` 支持 `afterAt/afterSeq`、`untilAt/untilSeq`、`epoch`，保留 seq-only 和 V8 by-position 兼容路径。
- **Web 消息窗口**：加入 tail/history 模式、增量追尾、older history 分页、unseen 计数、窗口裁剪与 `sessionStorage` 恢复；保留当前 `SessionChat`、AUTO、队列栏和会话大纲 UI。
- **边界取舍**：没有引入上游 `shared/src/apiTypes.ts`、原生客户端或 Codex Shared Sessions；本地类型仍位于 `web/src/types/api.ts`，减少协议冲突。

验证：`bun typecheck`、Hub 280 项测试、Web 546 项测试、Tail Sync 定向测试及 Web/Hub production build 均通过。构建中的 KaTeX 字体 unresolved 与 Browserslist stale 为既有 warning，不影响产物。

验证结果：`bun typecheck` 通过；Web SessionList/search 测试 36 项通过；Hub permissions/RpcGateway 测试通过；CLI permissionHandler 测试通过；现有 Codex launcher 历史过滤测试 14 项通过。`bun run build:single-exe`（宿主平台）也已通过。

第 3 步仅完成评估，Prepared Statement Cache、Content Codec、用户配置 MCP 未在本次主线上实现；具体风险与估算见 4.2。

### 路线 B：原生客户端优先

适用于明确要维护 iOS/Android、推送和 Relay 的团队。

1. 从 upstream/main 建立 upstream-native，先让上游 Android/iOS/Relay、协议 fixtures、Hub 通过 typecheck/test。
2. 按“部署 → 业务自动化 → 会话 UX”的顺序回迁当前能力：Docker/自部署认证 → AUTO → Project Tools/Cron → Port Mapping → Pin/筛选/分享。
3. 每回迁一项都以适配上游协议为准，不把当前 Hub 内部实现原样搬过去。
4. 该路线应视为 4–8 周以上的独立项目；不要与小版本上游同步混在同一个 PR。

## 6. 合并验收门槛

每个 backport 至少通过以下检查；数据库或协议改动需增加迁移 fixture：

    bun typecheck
    bun run test
    bun run build:single-exe

另外必须做：

- SQLite 备份后执行旧库 → 新库迁移，再回放长会话、Pin、分享、AUTO Retry；
- 浏览器和 CLI 同时在线时验证 SSE 压缩、断线重连、事件顺序；
- Docker 构建及自部署认证 smoke test；
- Codex/Claude/Gemini 至少各跑一次远程创建、权限请求、取消、重试和归档；
- 对新 Agent 做 resume、模型切换、权限模式和错误退出测试。

## 7. 可复现命令

以下命令用于本报告的 Git 基线和冲突估算，均不会修改工作树（merge-tree 只生成临时树）：

    git fetch upstream --prune
    git rev-list --left-right --count HEAD...upstream/main
    git merge-base HEAD upstream/main
    git diff --shortstat HEAD..upstream/main
    git merge-tree --write-tree HEAD upstream/main

## 8. 最终判断

当前项目和上游的共同代码仍多，但产品方向已经分叉：**上游适合做“多端 Agent 平台”，当前 fork 适合做“可自部署、可自动接管、面向项目运维的 Web/CLI 平台”。** 近期应采用小而可验证的 backport；只有在原生移动端或 Shared Sessions 成为硬需求时，才考虑以上游 main 为新基线的架构迁移。这样既能获得上游的性能和可靠性改进，也不会在一次大合并中丢失当前最有价值的自动化和部署能力。
