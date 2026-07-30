# Internal Markdown Editor Pane (PAN-3260)

Markdown file chips in chat (e.g. the Flywheel brief chip on
`docs/flywheel-brief.md`) open in an internal, editable Stage tab by
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
  `{ text, lang, mtimeMs, totalLines }`.
- **`pan.writeFileAtPath`** (`WS_METHODS.writeFileAtPath`) — `{ path, content,
  expectedMtimeMs? }` → `{ mtimeMs }`.

Unlike `readWorkspaceFile`, neither takes an `issueId` — this is what lets
the editor pane serve a repo-root file opened from a workspace-less
conversation. Both share one validation function
(`validateAndResolve` in `file-at-path.ts`):

- The path must be absolute and ≤4096 characters.
- The extension must be `.md`, `.mdx`, or `.markdown` — anything else
  rejects with `PanRpcError` code `UNSUPPORTED_FILE_TYPE`.
- The path is `realpath`'d (so a symlink that resolves outside the
  allowlist is caught, not just a lexical prefix check) and must land
  inside a registered project root (`listProjectsSync()`, each
  `config.path`) or `OVERDECK_HOME` — otherwise `PATH_NOT_ALLOWED`. This
  allowlist is deliberately narrower than the open-any-path
  `shellOpenInEditor` precedent, since this door also grants writes.
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
