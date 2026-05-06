# PAN-966: Open-in-Editor Integration

## Summary

Add an **Open in Editor** feature to the Panopticon dashboard, allowing users to open agent workspaces directly in Cursor, VS Code, Windsurf, Zed, or any installed editor with a single click. The implementation adopts T3Code's proven `open.ts` / `editor.ts` / `OpenInPicker.tsx` architecture verbatim (MIT-licensed), preserving class names, interfaces, and file structure to enable ongoing upstream merge from [T3Code](https://github.com/nicepkg/t3code).

## Motivation

Panopticon manages agent workspaces as git worktrees (`workspaces/feature-<issue-id>/`). Today, opening one in an editor requires manually copying the path from the InspectorPanel and running `cursor /path` or `code /path` in a terminal. This is friction that compounds across dozens of daily workspace interactions.

T3Code already solved this with a clean, cross-platform, well-tested implementation. Rather than reinvent, we adopt their exact patterns — renaming only `t3` → `pan` in service tags and storage keys — so we can pull upstream improvements with minimal merge conflicts.

## Design Goals

1. **Upstream-mergeable**: Preserve T3Code's file structure, class names, interfaces, and test patterns. Only rename `t3` → `pan` where it appears in service tags, localStorage keys, and package imports.
2. **Zero native integration**: Launch editors via CLI commands (`cursor`, `code`, `windsurf`), not editor extensions. Fire-and-forget detached processes.
3. **Auto-detect installed editors**: Scan `$PATH` at server startup, broadcast available editors to the frontend.
4. **Remember preference**: Persist last-used editor in localStorage, restore on next session.
5. **Async-only server code**: T3Code uses `statSync`/`accessSync` in `isCommandAvailable()`. Panopticon's server forbids sync FS calls (PAN-70, PAN-446). Port these to `fs/promises` equivalents.

## Upstream Divergence Strategy

T3Code's implementation uses sync FS calls (`statSync`, `accessSync`) in `isCommandAvailable()` and `isExecutableFile()`. Two options:

**Option A (recommended)**: Cache `resolveAvailableEditors()` once at server startup (which is the only call site in T3Code too). Remove the redundant `isCommandAvailable()` recheck inside `launchDetached()` and let `spawn` ENOENT surface as the error path. This minimizes the diff vs. upstream — only the caching wrapper and the removed recheck diverge.

**Option B**: Port all sync FS calls to `fs/promises`. Clean but creates a larger diff on every upstream merge since every function signature changes from sync → async.

## Supported Editors

Adopted from T3Code's `EDITORS` array, plus Windsurf (candidate for upstream PR to T3Code):

| id | label | command | supportsGoto |
|----|-------|---------|-------------|
| `cursor` | Cursor | `cursor` | yes |
| `windsurf` | Windsurf | `windsurf` | yes |
| `trae` | Trae | `trae` | yes |
| `vscode` | VS Code | `code` | yes |
| `vscode-insiders` | VS Code Insiders | `code-insiders` | yes |
| `vscodium` | VSCodium | `codium` | yes |
| `zed` | Zed | `zed` | no |
| `antigravity` | Antigravity | `agy` | no |
| `file-manager` | File Manager | platform-specific | no |

`supportsGoto`: editor supports `--goto path:line:col` for jump-to-location.

## Architecture

Mirrors T3Code exactly, with `@t3tools/contracts` → `@panctl/contracts`:

```
┌─────────────────────────────────────────────────────┐
│  Dashboard Frontend (React)                         │
│  - PanOpenInPicker component (from OpenInPicker)    │
│  - Editor preference persistence (localStorage)    │
│  - RPC client calls pan.shellOpenInEditor           │
└──────────────────┬──────────────────────────────────┘
                   │ WebSocket RPC
                   │ pan.shellOpenInEditor
                   ↓
┌─────────────────────────────────────────────────────┐
│  Dashboard Server (Effect)                          │
│  - ws-rpc.ts: RPC handler dispatch                  │
│  - PanOpen service (from Open service)              │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────┐
│  open.ts (from T3Code's apps/server/src/open.ts)    │
│  - resolveAvailableEditors (cached at startup)      │
│  - resolveEditorLaunch → EditorLaunch               │
│  - launchDetached (spawn, detached, stdio:ignore)   │
└──────────────────┬──────────────────────────────────┘
                   │
    ┌──────┬───────┼────────┬─────────┐
    ↓      ↓       ↓        ↓         ↓
 Cursor  Windsurf  VS Code  Zed   File Manager
```

## File Mapping (T3Code → Panopticon)

| T3Code source | Panopticon target | Changes |
|--------------|-------------------|---------|
| `packages/contracts/src/editor.ts` | `packages/contracts/src/editor.ts` | Add Windsurf entry; `OpenError` → reuse `PanRpcError` |
| `apps/server/src/open.ts` | `src/dashboard/server/services/open.ts` | `"t3/open"` → `"pan/open"`; async FS; cache available editors |
| `apps/server/src/open.test.ts` | `src/dashboard/server/services/__tests__/open.test.ts` | Same structure, add Windsurf tests |
| `apps/web/src/editorPreferences.ts` | `src/dashboard/frontend/src/editorPreferences.ts` | `"t3code:last-editor"` → `"panopticon:last-editor"` |
| `apps/web/src/components/chat/OpenInPicker.tsx` | `src/dashboard/frontend/src/components/PanOpenInPicker.tsx` | Import path changes only |
| (rpc.ts additions) | `packages/contracts/src/rpc.ts` | Add `shellOpenInEditor` to `WS_METHODS`, add RPC definition |

## Key Interfaces (preserved from T3Code)

```typescript
// packages/contracts/src/editor.ts
export const EDITORS = [
  { id: "cursor", label: "Cursor", command: "cursor", supportsGoto: true },
  { id: "windsurf", label: "Windsurf", command: "windsurf", supportsGoto: true },
  { id: "trae", label: "Trae", command: "trae", supportsGoto: true },
  { id: "vscode", label: "VS Code", command: "code", supportsGoto: true },
  { id: "vscode-insiders", label: "VS Code Insiders", command: "code-insiders", supportsGoto: true },
  { id: "vscodium", label: "VSCodium", command: "codium", supportsGoto: true },
  { id: "zed", label: "Zed", command: "zed", supportsGoto: false },
  { id: "antigravity", label: "Antigravity", command: "agy", supportsGoto: false },
  { id: "file-manager", label: "File Manager", command: null, supportsGoto: false },
] as const;

export const EditorId = Schema.Literals(EDITORS.map((e) => e.id));
export type EditorId = typeof EditorId.Type;

export const OpenInEditorInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  editor: EditorId,
});

// src/dashboard/server/services/open.ts
interface EditorLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

interface PanOpenShape {
  readonly openInEditor: (input: OpenInEditorInput) => Effect.Effect<void, PanRpcError>;
}

export class PanOpen extends ServiceMap.Service<PanOpen, PanOpenShape>()("pan/open") {}
```

## RPC Integration

Add to `packages/contracts/src/rpc.ts`:

```typescript
// In WS_METHODS:
shellOpenInEditor: "pan.shellOpenInEditor",

// RPC definition:
export const ShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: PanRpcError,
});

// Add to PanRpcGroup:
export const PanRpcGroup = RpcGroup.make(
  // ...existing 17 RPCs...
  ShellOpenInEditorRpc,
)
```

Server handler in `ws-rpc.ts`:
```typescript
[WS_METHODS.shellOpenInEditor]: (input) => panOpen.openInEditor(input),
```

## UI Surface

### Primary: InspectorPanel

The InspectorPanel already displays the workspace path (line 777). Add the `PanOpenInPicker` button group next to it:

```
┌─ Inspector: MIN-846 ─────────────────────────────────┐
│  Workspace: /home/.../workspaces/feature-min-846     │
│  [Cursor ▾]  ← PanOpenInPicker split button          │
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

The split button shows the preferred editor icon + "Open" label, with a dropdown chevron for the full editor menu (same UX as T3Code's `OpenInPicker`).

### Secondary: AgentList context menu

Add "Open in Editor" to the right-click context menu on agent rows, dispatching to the preferred editor without showing the picker.

### Server config broadcast

On WebSocket connection, the server includes `availableEditors: EditorId[]` in the initial config/snapshot response, so the frontend knows which editors to show.

## Implementation Phases

### Phase 1: Contracts + Server (backend)

1. Create `packages/contracts/src/editor.ts` with `EDITORS`, `EditorId`, `OpenInEditorInput`
2. Add `shellOpenInEditor` to `WS_METHODS` and `PanRpcGroup` in `rpc.ts`
3. Create `src/dashboard/server/services/open.ts` with async `PanOpen` service
4. Wire RPC handler in `ws-rpc.ts`
5. Add `availableEditors` to server config / snapshot response
6. Tests for all editors, goto flag, platform detection, detached launch

### Phase 2: Frontend

1. Create `src/dashboard/frontend/src/editorPreferences.ts`
2. Create `src/dashboard/frontend/src/components/PanOpenInPicker.tsx`
3. Add editor icons (Cursor, Windsurf, VS Code, Zed, Trae, Antigravity)
4. Integrate into InspectorPanel next to workspace path display
5. Add to AgentList context menu

### Phase 3: Polish

1. Keyboard shortcut for "open in preferred editor" (configurable)
2. `pan open <issue-id>` CLI command that launches the workspace in the preferred editor
3. Upstream PR to T3Code adding Windsurf support

## Acceptance Criteria

- [ ] `EDITORS` array in `@panctl/contracts` matches T3Code + Windsurf
- [ ] Server detects installed editors at startup via async PATH scan
- [ ] `pan.shellOpenInEditor` RPC launches editor as detached process
- [ ] `--goto` flag used when editor supports it and path contains `:line:col`
- [ ] InspectorPanel shows split-button editor picker when workspace exists
- [ ] Preferred editor persisted in localStorage, restored on reload
- [ ] Dropdown menu shows only installed editors
- [ ] File manager option maps to `xdg-open` on Linux, `open` on macOS, `explorer` on Windows
- [ ] No sync FS calls in any server-reachable code path
- [ ] Tests cover all editor types, goto flag, platform detection, spawn success/failure
- [ ] `npm run typecheck && npm run lint && npm test` pass
