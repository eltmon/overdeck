# KRUX-1: Project Scaffolding — State & Decisions

## Issue
**ID:** KRUX-1
**Title:** Project scaffolding: Electron + React + Vite + TypeScript
**Branch:** feature/krux-1

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Electron + Vite integration | **Electron Forge + Vite plugin** | Official Electron toolchain, includes packaging/publishing out of the box |
| Package manager | **npm** | Matches PRD and README conventions, no extra tooling |
| Placeholder layout | **3-column + sidebar** | Transcript \| Questions \| Insights columns with collapsible Config sidebar — matches PRD architecture diagram |
| Packaging | **Include in this issue** | electron-builder/Forge packaging so `npm run build` produces a distributable, per acceptance criteria |

## Architecture

### Directory Structure
```
krux/
├── package.json
├── forge.config.ts            # Electron Forge config with Vite plugin
├── vite.main.config.ts        # Vite config for main process
├── vite.renderer.config.ts    # Vite config for renderer process
├── vite.preload.config.ts     # Vite config for preload script
├── tsconfig.json              # Base TypeScript config
├── tailwind.config.ts         # Tailwind CSS config
├── postcss.config.js          # PostCSS config (Tailwind)
├── index.html                 # Renderer entry HTML
├── src/
│   ├── main/
│   │   └── index.ts           # Electron main process entry
│   ├── preload/
│   │   └── index.ts           # Preload script (IPC bridge)
│   └── renderer/
│       ├── index.tsx           # React entry point
│       ├── index.css           # Tailwind imports
│       └── App.tsx             # Root component with pane layout
└── .gitignore
```

### Key Patterns
- **Main process** (`src/main/`): Node.js context, creates BrowserWindow, loads renderer
- **Preload script** (`src/preload/`): Runs in renderer context with Node access, exposes safe IPC bridge via `contextBridge`
- **Renderer** (`src/renderer/`): React 19 app, no Node access, communicates via preload bridge
- **TypeScript**: Strict mode, separate configs for main (Node) and renderer (DOM) targets

### Placeholder Layout
```
┌─────────────────────────────────────────────────────┐
│  Krux                                    [Settings] │
├──────────────┬──────────────┬──────────────┬────────┤
│  Transcript  │  Questions   │  Insights    │ Config │
│              │              │              │ Side-  │
│  (placeholder│  (placeholder│  (placeholder│ bar    │
│   content)   │   content)   │   content)   │        │
│              │              │              │        │
│              │              │              │        │
└──────────────┴──────────────┴──────────────┴────────┘
```

## Scope

### In Scope
- Electron Forge project initialization with Vite plugin
- React 19 + TypeScript renderer
- Tailwind CSS setup
- Preload script with basic `contextBridge` skeleton
- 3-column + sidebar placeholder UI
- `npm run dev` with HMR
- `npm run build` producing a distributable via Forge
- `.gitignore` for node_modules, dist, out, etc.

### Out of Scope
- Audio capture / Deepgram integration
- AI service / LLM integration
- Context loader
- State management (Zustand/Jotai)
- API key management / electron-store
- Any actual functionality beyond the scaffold

## Task Breakdown

1. **Initialize Electron Forge project with Vite + TypeScript template** (medium)
   - Run `npm init electron-app@latest` with Vite-TypeScript template
   - Or manually set up package.json with Forge + Vite plugin dependencies
   - Configure forge.config.ts, vite configs for main/renderer/preload

2. **Set up TypeScript configuration** (simple)
   - Base tsconfig.json
   - Ensure main process targets Node, renderer targets DOM

3. **Add React 19 to renderer** (simple)
   - Install react, react-dom, @types/react, @types/react-dom
   - Create index.html, src/renderer/index.tsx entry
   - Update vite.renderer.config.ts for React (add @vitejs/plugin-react)

4. **Configure Tailwind CSS** (simple)
   - Install tailwindcss, postcss, autoprefixer
   - Create tailwind.config.ts, postcss.config.js
   - Add Tailwind directives to src/renderer/index.css

5. **Create preload script with IPC bridge skeleton** (simple)
   - src/preload/index.ts with contextBridge.exposeInMainWorld
   - Basic type declarations for the bridge API

6. **Build placeholder pane layout** (medium)
   - App.tsx with 3-column grid + collapsible sidebar
   - Tailwind-styled placeholder panes: Transcript, Questions, Insights, Config
   - Basic header bar with app title

7. **Verify dev and build scripts** (simple)
   - Confirm `npm run dev` launches Electron with HMR
   - Confirm `npm run build` / `npm run make` produces a distributable
   - Update .gitignore for Forge output directories

## Specialist Feedback

- **[2026-03-19T13:00Z] review-agent → VERIFICATION-FAILED** — `.planning/feedback/001-review-agent-verification-failed.md`
