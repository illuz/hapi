# hapi-web

React Mini App / PWA for monitoring and controlling hapi sessions.

## What it does

- Session list with status, pending approvals, todos, and summaries.
- Chat view with streaming updates and message sending.
- Permission approval and denial workflows.
- Permission mode and model selection.
- Machine list and remote session spawn.
- File browser and git status/diff views.
- PWA install prompt and offline banner.

## Runtime behavior

- When opened inside Telegram, auth uses Telegram WebApp init data.
- When opened in a normal browser, you can log in with `CLI_API_TOKEN:<namespace>` (or `CLI_API_TOKEN` for the default namespace).
- The login screen includes a top-right hub picker; if unset, the app uses the same origin it was loaded from.
- Live updates come from the hub via SSE.

## Routes

See `src/router.tsx` for route definitions.

- `/` - Redirect to /sessions.
- `/sessions` - Session list.
- `/sessions/$sessionId` - Chat interface.
- `/sessions/new` - Create new session.
- `/sessions/$sessionId/files` - File browser with git status.
- `/sessions/$sessionId/file` - File viewer with diff support.
- `/sessions/$sessionId/terminal` - Terminal interface.
- `/settings` - Application settings.

## Features

### Session list (`src/components/SessionList.tsx`)

- Active/inactive status indicator.
- Session title from name, summary, or path.
- Todo progress display.
- Pending permission request count.
- Agent flavor label (claude/codex/gemini).
- Model mode display.

### Chat interface (`src/components/SessionChat.tsx`)

- Message thread with infinite scroll.
- Composer for sending messages.
- Permission mode toggle (default/acceptEdits/bypassPermissions/plan).
- Model selection (default/sonnet/sonnet[1m]/opus/opus[1m]).
- Session abort and mode switch controls.
- Context size display.

### File browser (`src/routes/sessions/files.tsx`)

- Git status view (staged/unstaged files).
- File search with ripgrep.
- Navigate to file viewer.

### File viewer (`src/routes/sessions/file.tsx`)

- File content display with syntax highlighting.
- Staged/unstaged diff view.

### Terminal (`src/routes/sessions/terminal.tsx`)

- Remote terminal via xterm.js
- Real-time via Socket.IO
- Resize handling

### Voice assistant

- ElevenLabs integration (@elevenlabs/react)
- Real-time voice control

### New session (`src/components/NewSession/`)

Modular session creation:

- Machine selector
- Directory input with recent paths
- Agent type selector
- Model selector
- Permission mode toggle (YOLO mode)

## Authentication

See `src/hooks/useAuth.ts` and `src/hooks/useAuthSource.ts`.

- Telegram Mini App: Uses initData from WebApp SDK.
- Browser: Uses CLI_API_TOKEN from login prompt.
- JWT tokens with auto-refresh.

## Data fetching

See `src/hooks/queries/` for query hooks and `src/hooks/mutations/` for mutations.

- Sessions, messages, machines via TanStack Query.
- Git status and file operations.
- Optimistic updates for message sending.

## Real-time updates

See `src/hooks/useSSE.ts`.

- SSE connection to `/api/events`.
- Session/message/machine update events.
- Automatic cache invalidation on events.

## Stack

React 19 + Vite + TanStack Router/Query + Tailwind + @assistant-ui/react + xterm.js + @elevenlabs/react + socket.io-client + workbox + shiki.

## Source structure

- `src/router.tsx` - Route definitions.
- `src/components/` - UI components.
- `src/hooks/` - Data fetching and state hooks.
- `src/api/client.ts` - API client.
- `src/types/api.ts` - Type definitions.

## Codex rich-text directives

Both streaming assistant messages and static Markdown use
`src/lib/remark-codex-directives.ts`. This is a compatibility renderer, not an
implementation of the Codex desktop application's private APIs.

| Markup | HAPI behavior |
| --- | --- |
| `:codex-followup[label]{prompt="..."}` | Button appends the complete prompt to the active session's composer. Existing drafts are preserved; the user must send explicitly. Disabled in read-only previews. |
| `:codex-file-citation{path="..."}` (also `::`) | File chip using the existing session file access rules. Workbook `sheet`/`range` locators reach the Runner range endpoint; no automatic full-workbook download. Page, slide and line locators are displayed, but are not yet navigation targets. |
| `::code-comment{title="..." body="..." file="..." start=10 end=12 priority=2}` | Review card with severity, literal body and a safe file link. Line numbers are displayed, not scrolled to. |
| `::inbox-item{title="..." summary="..."}` | Summary card only; does not create an inbox record. |
| `:::writing{variant="email" id="12345"}` + body + closing `:::` | Copyable plain-text draft card. Does not send email or enable native document editing. |
| `::git-stage`, `::git-commit`, `::git-create-branch`, `::git-push`, `::git-create-pr` | Read-only operation cards; never run Git from Markdown. |
| `::codex-inline-vis{file="..."}`, `::codex-live-vis{path="..."}` | Metadata and an authorized file-preview link when possible. No automatic HTML execution or live runtime. |
| `::artifact-template`, `::automation-update`, `::archive-thread` | Read-only compatibility cards; no installation, scheduling or archiving. |
| `:codex-annotation{index="1"}`, `:codex-resource{...}` | Reference metadata only. Native Codex sidecar resources are not available in HAPI. |

The parser accepts quoted attributes (including escaped quotes and braces),
unquoted numeric/boolean attributes, and complete multiline values. Code spans,
fenced examples, links, HTML and escaped markers are not interpreted. Unknown,
invalid, incomplete or oversized directives remain visible as Markdown instead
of being silently removed. Individual directives are limited to 32,768 JavaScript
code units.
Writing blocks are recognized only with standalone opening/closing fences.
Persisted message content and copy-message behavior remain unchanged.

Sources checked on 2026-10-12:

- [Follow-up rendering report in the official Codex repository](https://github.com/openai/codex/issues/44983) — user-reported syntax, not a formal specification.
- [Codex Git/review directive implementation](https://github.com/openai/codex/blob/main/codex-rs/tui/src/git_action_directives.rs).
- [Codex inline visualization fallback](https://github.com/openai/codex/blob/main/codex-rs/tui/src/inline_visualization.rs).
- Installed ChatGPT/Codex application resources and bundled artifact-template skills were inspected read-only to cross-check writing, annotation, resource, inbox and template markers. Older automation/archive names receive display-only fallback.

No complete, stable public specification was found for all desktop directives.
The compatibility list is therefore deliberately explicit; unknown markers and
new native capabilities must not acquire execution privileges by default.

## Development

From the repo root:

```bash
bun install
bun run dev:web
```


If testing in Telegram, set:

- `HAPI_PUBLIC_URL` to the public HTTPS URL of the dev server.
- `CORS_ORIGINS` to include the dev server origin.

## Build

```bash
bun run build:web
```

The built assets land in `web/dist` and are served by hapi-hub. The single executable can embed these assets.

## Standalone hosting

You can host `web/dist` on a static host (GitHub Pages, Cloudflare Pages) and point it at any hapi hub:

1. Build the web app. If your static host uses a subpath, set the Vite base:

```bash
bun run build:web -- --base /<repo>/
```

2. Deploy `web/dist` to your static host.
3. Set hub CORS to allow the static origin (`HAPI_PUBLIC_URL` or `CORS_ORIGINS`).
4. Open the static site, click the top-right Hub button on the login screen, and enter the hapi hub origin.

Clear the hub override in the same dialog to return to same-origin behavior.
