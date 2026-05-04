# KRUX-2: Context Loader — State & Decisions

## Issue
**ID:** KRUX-2
**Title:** Context loader: directory ingestion and file parsing
**Branch:** feature/krux-2

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | **Full pipeline** | Parse files + format context for AI prompt injection. Produces a ready-to-use context payload per acceptance criteria. |
| PDF parsing | **pdfjs-dist** | Mozilla's PDF.js — robust, well-maintained. Heavier than pdf-parse but more reliable rendering. |
| Token budget | **Priority-based loading** | User can reorder/prioritize files. Highest priority loaded first within budget. More control over what AI sees. |
| File list UX | **Toggleable checkboxes** | Each file has a checkbox to include/exclude from context. Small extra effort, big UX win. |
| Prompt format | **Markdown sections** | Use markdown headers and code blocks per file. Human-readable, matches user preference. |
| Image handling | **Full base64 for vision** | Encode images as base64 content blocks for Claude/vision models. Enables actual image understanding. |
| File watching | **Auto-watch with debounce** | Use chokidar to detect directory changes and auto-reload. Better UX for active editing. |
| State management | **React useState + useReducer** | No external state library yet (Zustand/Jotai deferred). Keep it simple with React built-ins for now. |

## Architecture

### New Files & Structure
```
src/
├── main/
│   ├── index.ts                    # Add IPC handler registration
│   ├── context-loader.ts           # Core: directory reading, file parsing, watching
│   └── context-formatter.ts        # Format parsed context into AI prompt blocks
├── preload/
│   └── index.ts                    # Add typed IPC channels for context operations
├── renderer/
│   ├── App.tsx                     # Wire up context state, pass to sidebar
│   ├── hooks/
│   │   └── useContextLoader.ts     # Hook managing context state + IPC communication
│   └── components/
│       └── ContextFileList.tsx      # Toggleable file list with priority drag/status
└── shared/
    └── types.ts                    # Shared types for context files, IPC payloads
```

### Data Flow
```
User clicks "Select folder…"
    → Renderer sends IPC: 'context:select-directory'
    → Main process: dialog.showOpenDialog()
    → Main process: reads directory, parses files
    → Main process: starts chokidar watcher
    → Main sends IPC: 'context:files-loaded' with ContextFile[]
    → Renderer displays file list in sidebar

User toggles/reorders files
    → Renderer sends IPC: 'context:update-config' with file states
    → Main recalculates prompt context within token budget
    → Main sends IPC: 'context:prompt-ready' with formatted prompt

File changes on disk (chokidar)
    → Main re-parses changed files
    → Main sends IPC: 'context:files-updated' with updated ContextFile[]
    → Renderer updates file list
```

### IPC Channels
| Channel | Direction | Payload |
|---------|-----------|---------|
| `context:select-directory` | renderer → main | none |
| `context:refresh` | renderer → main | none |
| `context:update-config` | renderer → main | `{ files: FileConfig[] }` |
| `context:files-loaded` | main → renderer | `ContextFile[]` |
| `context:files-updated` | main → renderer | `ContextFile[]` |
| `context:prompt-ready` | main → renderer | `{ prompt: string, tokenEstimate: number, budget: number }` |
| `context:error` | main → renderer | `{ message: string, file?: string }` |

### Key Types (shared/types.ts)
```typescript
type FileType = 'markdown' | 'text' | 'image' | 'pdf' | 'unknown';

type FileStatus = 'loaded' | 'loading' | 'error' | 'skipped';

type ContextFile = {
  path: string;           // Absolute path
  relativePath: string;   // Relative to context directory
  name: string;
  type: FileType;
  status: FileStatus;
  size: number;           // Bytes
  tokenEstimate: number;  // Rough char/4 estimate
  enabled: boolean;       // User toggle
  priority: number;       // Lower = higher priority
  error?: string;
  content?: string;       // Parsed text content (not sent to renderer for images)
};

type ContextPrompt = {
  prompt: string;         // Formatted markdown prompt string
  imageBlocks: Array<{    // Separate image content for multi-modal API calls
    path: string;
    mimeType: string;
    base64: string;
  }>;
  tokenEstimate: number;
  budget: number;
  includedFiles: string[];
  skippedFiles: string[];
};
```

### File Parsing Strategy
| Extension | Parser | Output |
|-----------|--------|--------|
| `.md` | Read as UTF-8 | Raw markdown text |
| `.txt` | Read as UTF-8 | Plain text |
| `.png`, `.jpg`, `.jpeg` | Read as binary → base64 | Base64 string + mime type |
| `.pdf` | pdfjs-dist `getDocument()` → iterate pages → `getTextContent()` | Extracted text |
| Other | Skip with warning | — |

### Token Budget Strategy
- Default budget: 100,000 characters (~25K tokens)
- Files sorted by user priority (drag to reorder)
- Load files in priority order until budget exhausted
- Files exceeding remaining budget are marked `skipped`
- Images counted by a fixed estimate (e.g., 1000 tokens per image)
- Show budget usage bar in sidebar

### Prompt Format (Markdown Sections)
```markdown
## Context Files

### File: notes.md
```markdown
[file content here]
`` `

### File: agenda.txt
`` `text
[file content here]
`` `

### File: diagram.png
[Image included as vision content block — see imageBlocks]

### File: report.pdf
`` `text
[extracted PDF text here]
`` `
```

## Scope

### In Scope
- Native directory picker via Electron dialog
- File reading and parsing for .md, .txt, .png/.jpg, .pdf
- pdfjs-dist integration for PDF text extraction
- chokidar file watching with debounced reload
- Toggleable file list in config sidebar with priority ordering
- Token budget tracking with priority-based inclusion
- Formatted context output ready for AI prompt injection
- Multi-modal image support (base64 blocks for vision APIs)
- Error handling for unreadable/corrupt files
- IPC bridge extensions for all context operations

### Out of Scope
- Actual AI API calls (KRUX-3+)
- Drag-to-reorder UI (use up/down buttons for v1, drag later)
- Chunking/summarization of large individual files
- Recursive subdirectory traversal (flat directory only for v1)
- electron-store persistence of directory selection
- File type auto-detection beyond extension matching

## Task Breakdown

### Task 1: Shared types and IPC channel definitions (simple)
- Create `src/shared/types.ts` with all context-related types
- Update preload `index.ts` with typed channel helpers
- Estimated: 1-2 files, low risk

### Task 2: Core context loader — directory reading and file parsing (complex)
- Create `src/main/context-loader.ts`
- Implement `dialog.showOpenDialog` for directory selection
- File discovery: read directory, filter by supported extensions
- Parsers: UTF-8 text reader, base64 image encoder, pdfjs-dist PDF extractor
- chokidar watcher setup with debounce
- Token estimation (char/4 heuristic)
- Error handling for unreadable files
- Estimated: 1-2 files but significant logic, needs pdfjs-dist dep

### Task 3: Context formatter — prompt construction (medium)
- Create `src/main/context-formatter.ts`
- Priority-based file selection within token budget
- Markdown section formatting for text files
- Image block extraction for multi-modal APIs
- Budget calculation and reporting
- Estimated: 1 file, moderate logic

### Task 4: Main process IPC wiring (medium)
- Register all IPC handlers in `src/main/index.ts`
- Wire context-loader and context-formatter to IPC channels
- Handle lifecycle: select → load → watch → format → send
- Estimated: 1 file, cross-cutting

### Task 5: Renderer hook and state management (medium)
- Create `src/renderer/hooks/useContextLoader.ts`
- Manage context file list state, loading states, errors
- IPC communication with main process
- Expose actions: selectDirectory, toggleFile, refreshFiles
- Estimated: 1 file, moderate complexity

### Task 6: Context file list UI component (medium)
- Create `src/renderer/components/ContextFileList.tsx`
- Toggleable checkboxes per file
- File status indicators (loaded/error/skipped)
- Token budget usage bar
- Priority up/down buttons
- Wire into App.tsx sidebar
- Estimated: 2 files (component + App.tsx update)

### Task 7: Integration testing and polish (medium)
- Install pdfjs-dist and chokidar dependencies
- End-to-end flow: select directory → see files → toggle → verify prompt output
- Edge cases: empty directory, all files too large, binary files, permission errors
- Verify typecheck passes
- Estimated: cross-cutting, all files

## Specialist Feedback

- **[2026-03-19T21:02Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
