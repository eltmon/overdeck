# KRUX-7: Session Export — State & Implementation Plan

## Decisions Made

### Scope
- **Export formats:** Markdown (primary) + JSON (secondary)
- **Trigger:** Export button in SessionControls bar, visible when session is stopped and data exists
- **Auto-save:** Settings panel with directory picker; auto-exports on session end when configured
- **Data loss warning:** Confirmation dialog when starting a new session with unexported data

### Export Content
- **Sections:** Summary, Transcript, Questions, Insights, Conflicts, Action Items
- **Transcript:** Includes speaker labels (Speaker 1, Speaker 2) when available from Deepgram diarization
- **Timestamps:** Both wall-clock and elapsed time, e.g. `[14:32:05 / +05:23]`
- **Insight curation:** All insights included; pinned items marked with star; dismissed items excluded
- **Source quotes:** Each insight includes `source` field when available
- **Default filename:** `krux-session-YYYY-MM-DD-HHmm.md` (or `.json`)

### Architecture
- **Markdown/JSON generation:** New `src/main/export-service.ts` — pure functions, easy to test
- **Settings persistence:** New `src/main/settings-store.ts` — follows `session-store.ts` pattern, stores auto-export directory
- **IPC pattern:** Renderer gathers all export data (transcripts, insights, pinned/dismissed, summary) and sends to main via `export:save` invoke channel. Main generates file + shows dialog.
- **Conversation summary:** Need to expose `conversationSummary` from `AnalysisResult` to the renderer (currently stripped by typing). Fix `onAnalysisComplete` to include it and track in `useAIAnalysis`.

## Key Data Flow

```
User clicks "Export" (or session auto-ends with auto-save enabled)
    ↓
useExport hook gathers: transcripts, insights, pinned, dismissed, summary, sessionId
    ↓
IPC invoke → main process export handler
    ↓
export-service.ts: generateMarkdown() or generateJSON()
    ↓
If manual: dialog.showSaveDialog() → fs.writeFile()
If auto-save: write to configured directory directly
    ↓
IPC reply: { success, filePath } or { success: false, error }
```

## Files to Create/Modify

### New Files
| File | Purpose | Difficulty |
|------|---------|------------|
| `src/main/export-service.ts` | Markdown + JSON generation (pure functions) | medium |
| `src/main/settings-store.ts` | Auto-export directory persistence | simple |
| `src/renderer/hooks/useExport.ts` | Export hook — orchestrates data gathering + IPC | medium |
| `src/renderer/components/ExportSettings.tsx` | Auto-export directory picker UI | medium |
| `src/test/export-service.test.ts` | Tests for MD/JSON generation | medium |
| `src/test/settings-store.test.ts` | Tests for settings persistence | simple |
| `src/test/renderer/useExport.test.tsx` | Tests for export hook | medium |

### Modified Files
| File | Change | Difficulty |
|------|--------|------------|
| `src/shared/types.ts` | Add `ExportData`, `ExportFormat`, `ExportSettings` types | simple |
| `src/main/index.ts` | Add export IPC handlers (`export:save`, `export:auto-save-dir`) | medium |
| `src/preload/index.ts` | Add `export` API to bridge (invoke for save, send for settings) | simple |
| `src/main/ai-service.ts` | Change `onAnalysisComplete` signature to include `conversationSummary` | simple |
| `src/renderer/hooks/useAIAnalysis.ts` | Track `conversationSummary` from analysis results | simple |
| `src/renderer/components/SessionControls.tsx` | Add Export button + format selector | simple |
| `src/renderer/App.tsx` | Wire useExport, pass to SessionControls, add data-loss confirmation | medium |

## Out of Scope
- Exporting to cloud services (Google Drive, Notion, etc.)
- Custom Markdown templates
- PDF export
- Session replay
- Transcript editing before export

## Risks & Mitigations
- **Large transcripts:** Long sessions could produce very large MD files. Mitigation: stream write with `fs.createWriteStream` if needed, but `writeFile` should be fine for typical meeting lengths (< 10MB).
- **Missing summary:** If no analysis was run, `conversationSummary` will be empty. Mitigation: gracefully omit the Summary section or show "No analysis performed."
- **Concurrent export:** User clicks export while auto-save is writing. Mitigation: use a simple `exporting` flag to prevent double-writes.
