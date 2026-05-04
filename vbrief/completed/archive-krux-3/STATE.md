# KRUX-3: Deepgram Integration — State & Decisions

## Issue
**ID:** KRUX-3
**Title:** Deepgram integration: real-time audio capture and STT
**Branch:** feature/krux-3

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audio capture | **Web Audio API (AudioWorklet)** | Cross-platform, no native deps. AudioWorklet runs in separate thread for low-latency processing. Renderer captures audio, sends PCM chunks to main via IPC. |
| Deepgram connection | **Main process WebSocket** | Follows established pattern: main process handles I/O and network. Renderer sends audio chunks via IPC, main streams to Deepgram. |
| Deepgram model | **nova-3** | Latest model, best accuracy per tech notes. |
| Deepgram features | **smart_format + punctuate + diarize** | Enable diarize=true — if API key supports it, we get speaker labels; if not, Deepgram ignores gracefully. |
| API key storage | **safeStorage + UI input (all keys)** | Generic key manager for all 3 keys (Deepgram, Kimi, Anthropic). Electron safeStorage for encryption at rest. UI input in config sidebar. |
| Transcript UI | **Live pane + session controls + device selector** | Fill in existing placeholder transcript pane. Add start/pause/stop buttons and audio device dropdown in sidebar. |
| Reconnection | **Exponential backoff** | Retry with increasing delays (1s, 2s, 4s, 8s…) up to max ~30s. Auto-reconnect up to 5 attempts, then stop with error. Show connection status in UI. |
| State management | **React hooks (consistent with KRUX-2)** | Continue using useState/useCallback pattern. No external state library yet. |

## Architecture

### New Files & Structure
```
src/
├── main/
│   ├── index.ts                       # Add session + audio + apikey IPC handlers
│   ├── deepgram-service.ts            # Deepgram WebSocket client, reconnection logic
│   ├── api-key-manager.ts             # safeStorage read/write for all API keys
│   └── (existing) context-loader.ts
│   └── (existing) context-formatter.ts
├── preload/
│   └── index.ts                       # Add session, audio, apikey IPC channels
├── renderer/
│   ├── App.tsx                        # Wire up session state, transcript pane
│   ├── audio-worklet-processor.ts     # AudioWorklet processor (runs in worklet thread)
│   ├── hooks/
│   │   ├── (existing) useContextLoader.ts
│   │   ├── useAudioCapture.ts         # Web Audio API + AudioWorklet + device enum
│   │   └── useSession.ts             # Session lifecycle, transcript state, IPC
│   └── components/
│       ├── (existing) ContextFileList.tsx
│       ├── TranscriptPane.tsx         # Live scrolling transcript display
│       ├── SessionControls.tsx        # Start/pause/stop buttons + status indicator
│       ├── AudioDeviceSelector.tsx    # Microphone device dropdown
│       └── ApiKeyManager.tsx          # API key input fields (all 3 keys)
└── shared/
    └── types.ts                       # Add session, transcript, audio, apikey types
```

### Data Flow
```
User clicks "Start Session"
    → Renderer: getUserMedia() → AudioWorklet captures PCM chunks
    → Renderer sends IPC: 'audio:chunk' with Float32Array → Int16 PCM
    → Main process: deepgram-service opens WebSocket to Deepgram
    → Main process: streams PCM audio chunks to Deepgram WebSocket
    → Deepgram returns transcript results (interim + final)
    → Main sends IPC: 'session:transcript' with TranscriptEntry
    → Renderer appends to transcript pane (auto-scroll)

User clicks "Pause"
    → Renderer: suspends AudioContext (stops capture)
    → Main: keeps WebSocket open (Deepgram supports silence)

User clicks "Stop"
    → Renderer: stops MediaStream tracks, closes AudioContext
    → Main: closes Deepgram WebSocket cleanly

Connection drop
    → Main: detects WebSocket close/error
    → Main: exponential backoff reconnect (1s, 2s, 4s, 8s… max 30s)
    → Main sends IPC: 'session:status' with connection state
    → Renderer: shows connection status indicator
    → After 5 failures: stop session with error
```

### IPC Channels (New)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `session:start` | renderer → main | `{ deepgramKey: string }` |
| `session:pause` | renderer → main | none |
| `session:resume` | renderer → main | none |
| `session:stop` | renderer → main | none |
| `session:status` | main → renderer | `SessionStatus` |
| `session:transcript` | main → renderer | `TranscriptEntry` |
| `session:error` | main → renderer | `{ message: string }` |
| `audio:chunk` | renderer → main | `ArrayBuffer` (Int16 PCM) |
| `audio:devices` | renderer → main | none (request) |
| `audio:devices-list` | main → renderer | Not needed — device enum happens in renderer via navigator.mediaDevices |
| `apikey:save` | renderer → main | `{ provider: string, key: string }` |
| `apikey:load` | renderer → main | `{ provider: string }` |
| `apikey:load-result` | main → renderer | `{ provider: string, key: string \| null }` |
| `apikey:delete` | renderer → main | `{ provider: string }` |

*Note: Audio device enumeration uses navigator.mediaDevices.enumerateDevices() in renderer — no IPC needed for that.*

### Key Types (additions to shared/types.ts)
```typescript
type SessionState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type SessionStatus = {
  sessionState: SessionState;
  connectionState: ConnectionState;
  reconnectAttempt?: number;
  error?: string;
};

type TranscriptEntry = {
  id: string;
  text: string;
  isFinal: boolean;           // false = interim, true = final
  confidence: number;
  speaker?: number;           // Diarization speaker ID (if available)
  timestamp: number;          // Unix ms
  startTime: number;          // Audio timestamp (seconds from session start)
  endTime: number;
};

type ApiKeyProvider = 'deepgram' | 'kimi' | 'anthropic';
```

### AudioWorklet Pipeline
```
getUserMedia({ audio: { deviceId } })
    → MediaStreamSource
    → AudioWorkletNode (audio-capture-processor)
        → process(): accumulate Float32 samples into buffer
        → when buffer full (~4096 samples): post message to main thread
    → useAudioCapture hook receives message
    → Convert Float32 → Int16 PCM (linear16)
    → IPC send 'audio:chunk' to main process
    → DeepgramService writes to WebSocket
```

### Deepgram WebSocket Configuration
```typescript
{
  model: 'nova-3',
  language: 'en',
  smart_format: true,
  punctuate: true,
  diarize: true,
  interim_results: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1
}
```

### Reconnection Strategy
- On WebSocket close/error: start reconnect loop
- Delays: 1s → 2s → 4s → 8s → 16s → 30s (capped)
- Max attempts: 5 per session
- On reconnect: re-open WebSocket with same config
- Emit `session:status` with `connectionState: 'reconnecting'` and attempt count
- After max failures: emit `session:error`, transition to `error` state
- User can manually retry by stopping and restarting session

### safeStorage API Key Manager
- Uses `electron.safeStorage.encryptString()` / `decryptString()`
- Keys stored in app's userData directory as encrypted files
- File per key: `apikey-deepgram.enc`, `apikey-kimi.enc`, `apikey-anthropic.enc`
- Check `safeStorage.isEncryptionAvailable()` — fallback to plaintext with warning on unsupported platforms

## Scope

### In Scope
- AudioWorklet-based microphone capture with device selection
- Deepgram WebSocket streaming (nova-3, smart_format, punctuate, diarize)
- Interim and final transcript parsing and display
- Live transcript pane with auto-scroll
- Start/pause/stop session controls
- Connection status indicator
- Exponential backoff reconnection (up to 5 attempts)
- Generic API key manager (all 3 keys) with safeStorage encryption
- API key input UI in config sidebar
- IPC bridge extensions for all new channels
- Comprehensive tests for DeepgramService and ApiKeyManager

### Out of Scope
- AI analysis pipeline (KRUX-4+)
- Session persistence / history
- Transcript export
- Multi-speaker color coding in UI (future feature, per PRD)
- Audio recording to file
- Custom Deepgram model/language selection UI
- electron-store for user preferences (separate concern)

## Current Status

**COMPLETE** — All 8 tasks implemented and tested. 36 tests passing, typecheck clean.

### Completed Tasks
- [x] Task 1: Shared types and IPC definitions — types added to `shared/types.ts`, preload extended
- [x] Task 2: API key manager service — `src/main/api-key-manager.ts` with safeStorage
- [x] Task 3: API key manager UI — `src/renderer/components/ApiKeyManager.tsx`
- [x] Task 4: Deepgram WebSocket service — `src/main/deepgram-service.ts` with exponential backoff
- [x] Task 5: Audio capture — `src/renderer/hooks/useAudioCapture.ts` with AudioWorklet (inlined blob)
- [x] Task 6: Session lifecycle — `src/renderer/hooks/useSession.ts`
- [x] Task 7: UI components — `TranscriptPane.tsx`, `SessionControls.tsx`, `AudioDeviceSelector.tsx`, `App.tsx` updated
- [x] Task 8: Tests — `deepgram-service.test.ts` (11 tests), `api-key-manager.test.ts` (7 tests)

### Key Implementation Notes
- AudioWorklet processor is inlined as a blob URL to avoid Vite bundler complications
- `ws` package added as a dependency (installed in workspace node_modules, externalized in vite.main.config.ts)
- Deepgram reconnection: exponential backoff 1s→2s→4s→8s→16s→30s, max 5 attempts

### Remaining Work
None — all checks passed (review + tests green). Ready for merge.

## Task Breakdown

### Task 1: Shared types and IPC definitions (simple)
- Add session, transcript, connection, and API key types to `src/shared/types.ts`
- Extend preload `index.ts` with typed session + audio + apikey channel helpers
- **Files:** 2 (shared/types.ts, preload/index.ts)
- **Difficulty:** simple

### Task 2: API key manager — safeStorage service (medium)
- Create `src/main/api-key-manager.ts`
- Implement save/load/delete with safeStorage encryption
- Fallback handling for platforms without encryption
- Register IPC handlers in main/index.ts
- **Files:** 2 (api-key-manager.ts, main/index.ts)
- **Difficulty:** medium
- **Depends on:** Task 1

### Task 3: API key manager UI (medium)
- Create `src/renderer/components/ApiKeyManager.tsx`
- Input fields for all 3 providers with save/clear buttons
- Masked display of stored keys
- Wire into App.tsx config sidebar
- **Files:** 2 (ApiKeyManager.tsx, App.tsx)
- **Difficulty:** medium
- **Depends on:** Task 1, Task 2

### Task 4: Deepgram WebSocket service (complex)
- Create `src/main/deepgram-service.ts`
- WebSocket connection to Deepgram with nova-3 config
- Accept PCM audio chunks and stream to WebSocket
- Parse interim/final transcript responses
- Exponential backoff reconnection logic
- Emit transcript entries and status updates via callbacks
- **Files:** 1 (deepgram-service.ts) but significant logic
- **Difficulty:** complex
- **Depends on:** Task 1

### Task 5: Audio capture — AudioWorklet pipeline (complex)
- Create `src/renderer/audio-worklet-processor.ts` (worklet file)
- Create `src/renderer/hooks/useAudioCapture.ts`
- getUserMedia + AudioWorklet setup
- Float32 → Int16 PCM conversion
- Device enumeration and selection
- Start/stop/pause audio capture
- Send PCM chunks via IPC to main
- **Files:** 2 (worklet processor, hook)
- **Difficulty:** complex
- **Depends on:** Task 1

### Task 6: Session lifecycle and IPC wiring (complex)
- Create `src/renderer/hooks/useSession.ts`
- Session state machine (idle → starting → recording → paused → stopping)
- Wire audio chunks from useAudioCapture → IPC → DeepgramService
- Register all session IPC handlers in main/index.ts
- Transcript accumulation (replace interim with final)
- Connection status tracking
- **Files:** 2 (useSession.ts, main/index.ts)
- **Difficulty:** complex
- **Depends on:** Task 1, Task 4, Task 5

### Task 7: Transcript pane and session controls UI (medium)
- Create `src/renderer/components/TranscriptPane.tsx`
- Create `src/renderer/components/SessionControls.tsx`
- Create `src/renderer/components/AudioDeviceSelector.tsx`
- Wire into App.tsx — fill transcript pane, add controls to sidebar
- Auto-scrolling transcript with interim/final styling
- Connection status indicator
- **Files:** 4 (3 components + App.tsx)
- **Difficulty:** medium
- **Depends on:** Task 5, Task 6

### Task 8: Tests and integration (medium)
- Unit tests for DeepgramService (mock WebSocket)
- Unit tests for ApiKeyManager (mock safeStorage)
- Verify typecheck passes
- **Files:** 2 test files
- **Difficulty:** medium
- **Depends on:** Task 2, Task 4

### Dependency Graph
```
Task 1 (types + IPC)
  ├── Task 2 (API key manager service)
  │     └── Task 3 (API key manager UI)
  ├── Task 4 (Deepgram service)
  │     └── Task 6 (session lifecycle) ←── also depends on Task 5
  │           └── Task 7 (UI components)
  ├── Task 5 (audio capture)
  │     └── Task 6 (session lifecycle)
  └── Task 8 (tests) ←── depends on Task 2, Task 4
```

## Specialist Feedback

- **[2026-03-20T15:44Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-03-20T16:19Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
- **[2026-03-20T19:02Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
