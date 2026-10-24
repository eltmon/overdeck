# Internal Markdown Editor Pane (PAN-3260, PAN-4583)

Markdown file chips in chat (e.g. a PRD chip on
`.pan/drafts/<issue>.md`) open in an internal, editable Stage tab by
default instead of always launching an external editor. Right-click still
offers the external editors, plus the internal option, and the choice
persists. This doc covers the four pieces that implement it.

## The `editor` pane type

`src/dashboard/frontend/src/lib/panesStore.ts` adds `'editor'` to `PaneType`
and an `editorFilePath?: string` field to `WorkspacePane` — the absolute
path of the file being edited. `src/dashboard/frontend/src/components/Stage/index.tsx`
dispatches `paneType: 'editor'` panes to
`src/dashboard/frontend/src/components/Stage/panes/EditorPane.tsx` from its
`renderPane` switch, and registers `editor: 'Editor'` in `PANE_LABELS`
(`Record<PaneType, string>`) and `editor: Pencil` in `PaneBar.tsx`'s
`PANE_ICONS` (`Record<PaneType, typeof Home>`) — both are exhaustive
records, so any new `PaneType` member must be added to both.

**`editor` is deliberately excluded from Stage's `ISSUE_SCOPED` self-heal
set** (`Stage/index.tsx`, the `useEffect` that drops `files`/`commits`/
`plan`/`docs` panes created without an `issueId`). An editor pane's
identity is its `editorFilePath`, not an issue — the reported case (the
Flywheel brief chip) opens from a *conversation* with no workspace/issue
context at all. Adding `'editor'` to `ISSUE_SCOPED` would silently close
every editor tab opened from a workspace-less surface on the next deck
load. `EditorPane.test.tsx`'s "editor pane survives the Stage self-heal
effect" test guards this by mounting the full `Stage` with a pre-seeded,
issueId-less editor pane and asserting it survives.

`EditorPane` renders Edit/Preview sub-tabs styled like `DocsPane`'s
`subTabs`/`subTab`/`subTabActive`/`subBody` classes. Preview reuses the
existing `MarkdownTab` component (which wraps `ChatMarkdown`) rather than
introducing a second markdown renderer — there is exactly one markdown
renderer in the app. Edit is a plain monospace `<textarea>`; there is no
syntax-highlighted editing surface and no new npm dependency.

## The file-at-path RPC door

Two RPC methods, defined in `packages/contracts/src/rpc.ts` and implemented
in `src/dashboard/server/services/file-at-path.ts` (wired into
`src/dashboard/server/ws-rpc.ts` next to `readWorkspaceFile`):

- **`pan.readFileAtPath`** (`WS_METHODS.readFileAtPath`) — `{ path }` →
  `{ text, lang, mtimeMs, totalLines, writable }`.
- **`pan.writeFileAtPath`** (`WS_METHODS.writeFileAtPath`) — `{ path, content,
  expectedMtimeMs? }` → `{ mtimeMs }`.

Unlike `readWorkspaceFile`, neither takes an `issueId` — this is what lets
the editor pane serve a repo-root file opened from a workspace-less
conversation. Both share one validation function
(`validateAndResolve(path, door)` in `file-at-path.ts`), and the containment
check depends on `door`:

- The path must be absolute and ≤4096 characters.
- The extension must be `.md`, `.mdx`, or `.markdown` — anything else
  rejects with `PanRpcError` code `UNSUPPORTED_FILE_TYPE`.
- The path is `realpath`'d (so a symlink that resolves outside the
  allowlist is caught, not just a lexical prefix check). For a **write**,
  the realpath must land inside a write root — a registered project root
  (`listProjectsSync()`, each `config.path`) or `OVERDECK_HOME` — otherwise
  `PATH_NOT_ALLOWED` ("Path is outside the allowed project roots"). For a
  **read**, the realpath may also land inside the operator's home
  directory (`os.homedir()`, realpath'd); outside both rejects with
  `PATH_NOT_ALLOWED` ("Path is outside your home directory and the
  registered project roots"). `writable` is `true` exactly when the file is
  inside a write root, so `writeFileAtPath` will accept it (PAN-4583).
- It must already exist as a regular file, or the call rejects with
  `FILE_NOT_FOUND`. **The write door never creates files** — writing to a
  path that doesn't exist fails the same way reading it would.

`readFileAtPath` additionally rejects files over 1 MiB with `FILE_TOO_LARGE`
and returns no text in that case — the door errors instead of truncating,
so the editor can never load (and later save back) a partial buffer.

`writeFileAtPath` implements optimistic concurrency via `expectedMtimeMs`:
if provided and it no longer matches the file's on-disk `mtimeMs`, the
write is rejected with `WRITE_CONFLICT` and nothing is written. Omitting
`expectedMtimeMs` (the pane's "Overwrite" action) skips the check.
`EditorPane` shows an inline banner on `WRITE_CONFLICT` with two actions:
**Reload from disk** (discards the draft, re-reads via `readFileAtPath`)
and **Overwrite** (resends `writeFileAtPath` without `expectedMtimeMs`).

`EditorPane` opens a `writable: false` file read-only (PAN-4583): the
textarea gets the `readonly` attribute and ignores change events, the Save
button is disabled, Ctrl/Cmd+S sends no write, and a note
(`data-testid="editor-pane-readonly-note"`) reads "Read-only — this file is
outside the registered project roots."

## Who can call this door

Every `/ws/rpc` caller — including this one — already holds admin-equivalent
access, so the PAN-4583 read widening (home root, not just the write roots)
grants no caller anything it didn't already have:

1. **Every `/ws/rpc` caller holds the `admin` scope.**
   `rejectUnauthorizedRpcUpgrade` (`src/dashboard/server/ws-rpc.ts`) and the
   upgrade handler call `authorizeDashboardUpgrade(headers, method)`
   (`src/dashboard/server/ws-auth.ts`), whose default `requiredScope` is
   `'admin'`. It checks the origin, then requires a credential (session
   cookie, internal token, or an `odk_` registry credential), then requires
   the scope. `docs/DASHBOARD-AUTH.md` lists `/ws/rpc` under `admin`.
2. **`admin` already grants a shell as the dashboard user.** `scopeSatisfies`
   (`src/lib/access-tokens.ts`) returns true for any required scope when
   `admin` is granted, and `/ws/terminal` needs only `operate`. So every
   `/ws/rpc` caller can already open a terminal pane and `cat` any file the
   dashboard user can read, which includes everything under `$HOME`.
3. **Callers by surface.** The local operator's browser (session cookie for
   loopback peers), the domain/Traefik-exposed dashboard (same credential
   requirement — `remote-request-gate.ts` and `ws-auth.ts` apply to remote
   peers too), paired devices (pairing always grants `['admin']`), and the
   desktop app (runs the same server, authenticates the same way) all reach
   `/ws/rpc` only with `admin`. A token without `admin` gets 403 at the
   upgrade.
4. **Shared Sessions viewers cannot reach `/ws/rpc`.** The share service
   (`services/share`, `docs/SHARED-SESSIONS.md`) is a Cloudflare Worker that
   relays WebRTC signaling only; no host-side transport in this repo routes
   a viewer message to any RPC handler. If a later Shared Sessions phase
   proxies RPCs over the DataChannel, `readFileAtPath` and `writeFileAtPath`
   must be excluded from the proxied set — a hazard for that future work,
   not a change made here.

## StageDeckContext — how a chip reaches its deck

`src/dashboard/frontend/src/components/Stage/StageDeckContext.tsx` is a
plain React context (`{ deckKey, openOrFocusEditorPane }` or `null`),
provided by `Stage` around everything it renders. It exists because the
Stage's own `StageApi`/`StageContext` are handed to pane wrappers as props,
not via context — a `MarkdownFileLink` chip can be nested arbitrarily deep
inside a pane's content (`AgentPane` → `ConversationPanel` → `ChatMarkdown`
→ `MarkdownFileLink`), too deep to prop-thread cleanly.
`useStageDeck()` returns `null` outside a `Stage` (popout conversation
windows, `ConversationDock`, issue-drawer transcripts) — those surfaces have
nowhere to open an internal tab and fall back to the external flow.
`openOrFocusEditorPane(filePath, label)` mirrors the existing
`openIssue`/`openOrFocusAgentPane` find-or-focus dedupe pattern: a second
call with the same `filePath` focuses the existing tab instead of opening a
duplicate.

## The open-target preference and the fallback matrix

`src/dashboard/frontend/src/editorPreferences.ts` adds:

- `getMarkdownOpenTarget(): 'internal' | EditorId` — reads localStorage key
  **`overdeck:markdown-open-target`**, defaulting to `'internal'`.
- `setMarkdownOpenTarget(target)` — persists it.

This is a separate key from `overdeck:last-editor` (the existing
general "preferred external editor" preference used by non-markdown chips
and by the internal-target's own external fallback) — markdown defaults to
internal while everything else defaults to external, so the two
preferences must vary independently.

`MarkdownFileLink.tsx` routes a left click through `handleMarkdownClick`
only for markdown paths (`isMarkdownPath`, checking the `.md`/`.mdx`/
`.markdown` extensions via the existing `extensionOfPath`); non-markdown
chips always call the original `handleOpen()`. The fallback matrix:

| Chip type | Deck context | `overdeck:markdown-open-target` | Left click opens |
| --- | --- | --- | --- |
| markdown | present (Stage) | `'internal'` (default) | the internal editor pane |
| markdown | present (Stage) | a specific `EditorId` | that external editor |
| markdown | **absent** (popout/dock/drawer) | `'internal'` | falls back to the external flow (`handleOpen()`) |
| markdown | absent | a specific `EditorId` | that external editor (deck context doesn't matter for an external target) |
| non-markdown | any | n/a | the external flow, unchanged |

Right-click on a markdown chip lists **Open in internal editor**, one
**Open in `<EDITORS label>`** entry per editor the server reports available
(`pan.getAvailableEditors`, fetched once and cached module-wide, same
pattern as the chip's Quickview syntax-highlighter cache), then the
existing **Copy relative path** / **Copy full path** items. Choosing any
open action calls `setMarkdownOpenTarget` before opening, so the choice
survives a reload. Right-click on a non-markdown chip is unchanged — still
exactly **Open in editor** / **Copy relative path** / **Copy full path**.
