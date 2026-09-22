# HAPI 用户端安装与使用

本文适用于这样的使用场景：管理员已经部署好 HAPI Hub，并向你提供：

- **Hub 地址**：例如 `https://hapi.example.com`；
- **API Key**：用于 CLI、Runner 和 Web 登录的访问令牌。

你只需要在自己的电脑上安装 HAPI CLI，并把本机的 AI coding agent 连接到这个 Hub。

::: warning 先保护好 API Key
API Key 等同于访问凭据。不要把真实 Key 提交到 Git、截图、工单或公开聊天中。
本文所有 `YOUR_API_KEY` 都是占位符，请替换成管理员发给你的值。
:::

## 1. 你需要准备什么

### 管理员提供的信息

| 信息 | 示例 | 用途 |
| --- | --- | --- |
| Hub 地址 | `https://hapi.example.com` | CLI 和浏览器连接的服务器地址 |
| API Key | `YOUR_API_KEY` | 认证 CLI、Runner 和 Web |
| Namespace（可选） | `alice` | 多用户 Hub 中隔离会话和机器 |

如果管理员提供的 Key 形如 `base-token:alice`，请完整保留 `:alice` 后缀，不要自行删除。

### 本机环境

1. 安装 Node.js 和 npm；
2. 安装并登录至少一个 AI coding agent；
3. 准备一个稳定且唯一的 **Machine ID**，例如 `alice-win-01`。

HAPI API Key 只负责连接 HAPI Hub，不包含 Claude、Codex、Gemini、Cursor 或 OpenCode 的模型额度。AI agent 仍需按其官方方式单独安装和登录。

检查 npm：

```bash
node --version
npm --version
```

检查已安装的 agent（按实际使用的 agent 执行）：

```bash
claude --version
codex --version
agent --version
gemini --version
opencode --version
```

## 2. 安装 HAPI CLI

推荐使用 npm 全局安装：

```bash
npm install -g @illuz-modified/hapi --registry=https://registry.npmjs.org
```

确认安装成功：

```bash
hapi --version
```

如果 npm 使用了企业镜像或其他镜像，出现平台二进制缺失时，改用上面的官方 npm Registry 重新安装。

## 3. 配置 Hub 地址和 API Key

### 推荐：API Key 交互式输入

这种方式不会把 API Key 直接写进 shell history：

```bash
hapi auth login --host=https://hapi.example.com --machineId=alice-win-01
```

按提示输入管理员提供的 API Key。命令会把配置保存到：

- Windows：`%USERPROFILE%\.hapi\settings.json`；
- macOS/Linux：`~/.hapi/settings.json`。

### 一键配置：适合自动化安装

如果你明确接受 API Key 出现在命令行 history 中，可以一次完成全部配置：

```bash
hapi auth login --host=https://hapi.example.com --machineId=alice-win-01 --cliApiToken=YOUR_API_KEY
```

也支持空格分隔的写法：

```bash
hapi auth login --host https://hapi.example.com --machineId alice-win-01 --cliApiToken YOUR_API_KEY
```

参数说明：

| 参数 | 是否必需 | 说明 |
| --- | --- | --- |
| `--host` | 建议提供 | 保存 Hub 地址，只接受 `http://` 或 `https://` |
| `--machineId` | 建议提供 | 本机唯一标识；同一 Hub 上不要让多台机器复用 |
| `--cliApiToken` | 可选 | 直接保存 API Key；省略后会交互式询问 |

保存后，后续 CLI 和 Runner 不需要再设置 `HAPI_API_URL` 或 `CLI_API_TOKEN`。

> 如果系统环境变量中已经设置了 `HAPI_API_URL` 或 `CLI_API_TOKEN`，环境变量优先级更高，可能覆盖这里保存的值。

`settings.json` 会保存 `cliApiToken`。在多人共用电脑上，请确保操作系统账户和该文件仅对授权用户可访问。
如果多个用户使用同一个没有 namespace 的 Key，他们可能共享同一个 Hub 空间；需要隔离时请向管理员申请独立 Key 或 namespace。

## 4. 验证配置

查看当前配置（不会显示完整 API Key）：

```bash
hapi auth status
```

重点确认：

- `HAPI_API_URL` 是管理员提供的 Hub 地址；
- `CLI_API_TOKEN` 显示为 `set`；
- `Machine ID` 是当前电脑的唯一 ID。

运行诊断：

```bash
hapi doctor
```

如果诊断通过，说明 CLI 已能访问 Hub。若 Web 端也需要登录，请在浏览器打开同一个 Hub 地址，并输入同一个 API Key。

## 5. 启动 Runner（允许手机或 Web 远程创建会话）

Runner 是运行在你电脑上的后台进程。它连接 Hub，并根据 Web/手机的请求在本机启动 AI coding agent。

### 不限制工作目录

```bash
hapi runner start
```

### 推荐：限制可访问的工作目录

Windows PowerShell：

```powershell
hapi runner start --workspace-root "C:\Users\Alice\Projects"
```

macOS/Linux：

```bash
hapi runner start --workspace-root "$HOME/Projects"
```

可以重复传入多个目录：

```powershell
hapi runner start `
  --workspace-root "D:\Projects" `
  --workspace-root "E:\Work"
```

设置 `--workspace-root` 后，Web 的文件浏览和远程创建会话只能访问这些目录；省略该参数则不启用工作区浏览。

检查 Runner：

```bash
hapi runner status
hapi runner logs
```

停止 Runner：

```bash
hapi runner stop
```

## 6. 启动本地 coding session

默认命令启动 Claude Code：

```bash
hapi
```

也可以明确选择 agent：

```bash
hapi claude
hapi codex
hapi cursor
hapi gemini
hapi opencode
```

启动后，session 会出现在 Hub 的 Web 界面中。你可以在电脑终端继续工作，也可以从手机或浏览器查看消息、处理权限请求。

::: tip Windows 限制
Windows 当前不支持 HAPI 的远程 Terminal 功能，但 Runner、远程创建 session、消息同步和权限处理仍可使用。
:::

## 7. Windows 登录后自动启动 Runner

如果希望每次登录 Windows 后 Runner 自动启动，推荐使用 **任务计划程序**。

### 图形界面方式

1. 打开“任务计划程序”，选择“创建任务”；
2. “常规”页：使用当前 Windows 用户，不要使用 `SYSTEM`；选择“仅当用户登录时运行”；
3. “触发器”页：新建“登录时”；
4. “操作”页：
   - 程序：`C:\Windows\System32\cmd.exe`；
   - 参数：

     ```text
     /d /c ""C:\Users\你的用户名\AppData\Roaming\npm\hapi.cmd" runner start-sync --workspace-root "C:\Users\你的用户名\Projects""
     ```

   - “起始于”：`%USERPROFILE%`；
5. “设置”页：开启失败后自动重启；
6. 保存后右键任务，选择“运行”进行测试。

用下面的命令查找实际的 `hapi.cmd` 路径：

```powershell
where.exe hapi.cmd
```

任务计划程序中使用 `runner start-sync` 是有意为之：它是常驻前台进程，适合由任务计划程序监控。手动启动时使用 `hapi runner start` 即可。

### PowerShell 自动创建任务

下面脚本会为当前用户创建登录启动任务。先修改 `$workspace`；如果不需要工作区浏览，将 `$arguments` 改为脚本注释中的无目录版本。

```powershell
$hapi = (Get-Command hapi.cmd -ErrorAction Stop).Source
$workspace = 'C:\Users\Alice\Projects'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$arguments = '/d /c ""{0}" runner start-sync --workspace-root "{1}""' -f $hapi, $workspace
# 不需要工作区浏览时使用：
# $arguments = '/d /c ""{0}" runner start-sync"' -f $hapi
$action = New-ScheduledTaskAction `
  -Execute $env:ComSpec `
  -Argument $arguments `
  -WorkingDirectory $env:USERPROFILE
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal `
  -UserId $user `
  -LogonType InteractiveToken `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName 'HAPI Runner' `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force

Start-ScheduledTask -TaskName 'HAPI Runner'
```

查看或删除任务：

```powershell
Get-ScheduledTask -TaskName 'HAPI Runner'
Get-ScheduledTaskInfo -TaskName 'HAPI Runner'
Unregister-ScheduledTask -TaskName 'HAPI Runner' -Confirm:$false
```

## 8. macOS/Linux 后台运行（可选）

手动启动 Runner：

```bash
hapi runner start
```

需要开机或登录自动启动时，使用系统服务管理器：

- macOS：使用 `launchd` 用户级 `LaunchAgent`；
- Linux：使用 `systemd --user`，服务的常驻入口使用 `hapi runner start-sync`。

如果管理员已经提供了统一的服务安装脚本，优先使用管理员脚本；否则参阅 [完整安装说明](./installation.md#background-service-deployment)。

## 9. 更新与卸载

更新 CLI：

```bash
hapi runner stop
npm update -g @illuz-modified/hapi --registry=https://registry.npmjs.org
hapi --version
```

卸载 CLI：

```bash
hapi runner stop
npm uninstall -g @illuz-modified/hapi
```

卸载 CLI 不会自动删除 `~/.hapi` 或 `%USERPROFILE%\.hapi` 中的配置和日志。如需彻底清理，请先备份后删除该目录。

## 10. 常见问题

### `hapi auth status` 显示了错误的地址

环境变量优先于 `settings.json`。检查并清除临时覆盖：

PowerShell：

```powershell
Get-ChildItem Env:HAPI_API_URL
Remove-Item Env:HAPI_API_URL -ErrorAction SilentlyContinue
```

macOS/Linux：

```bash
echo "$HAPI_API_URL"
unset HAPI_API_URL
```

然后重新运行：

```bash
hapi auth status
```

### `Invalid token` 或 `Authentication failed`

1. 确认 Hub 地址是管理员提供的 HTTPS 地址；
2. 确认 API Key 完整复制，没有多余空格或换行；
3. 如果 Key 含有 namespace 后缀，确认后缀没有被删除；
4. 重新配置：

   ```bash
   hapi auth login --host=https://hapi.example.com --machineId=alice-win-01
   ```

### Runner 没有出现在 Web 的 Machines 列表

```bash
hapi runner status
hapi runner logs
hapi doctor
```

Windows 可以清理陈旧的锁文件后重试：

```powershell
hapi runner stop
Remove-Item "$env:USERPROFILE\.hapi\runner.state.json.lock" -Force -ErrorAction SilentlyContinue
hapi runner start
```

### `workspace-root` 报路径不存在

目录必须预先存在，并且当前 Windows 用户有读写权限。路径包含空格时必须加引号：

```powershell
Test-Path "C:\Users\Alice\My Projects"
hapi runner start --workspace-root "C:\Users\Alice\My Projects"
```

### npm 安装后提示缺少平台二进制

使用官方 npm Registry 重新安装：

```bash
npm uninstall -g @illuz-modified/hapi
npm install -g @illuz-modified/hapi --registry=https://registry.npmjs.org
```

## 11. 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `hapi auth status` | 查看 Hub、token 和 Machine ID 配置 |
| `hapi auth login ...` | 保存或更新连接配置 |
| `hapi doctor` | 运行诊断 |
| `hapi runner start` | 后台启动 Runner |
| `hapi runner status` | 查看 Runner 状态 |
| `hapi runner logs` | 查看 Runner 日志路径 |
| `hapi runner stop` | 停止 Runner |
| `hapi` | 启动默认 Claude Code session |
| `hapi codex` | 启动 Codex session |
| `hapi cursor` | 启动 Cursor Agent session |
| `hapi gemini` | 启动 Gemini session |
| `hapi opencode` | 启动 OpenCode session |
