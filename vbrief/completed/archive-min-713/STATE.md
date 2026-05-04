# STATE.md: MIN-713 - DIY Voice Pipeline

> **Status:** Review feedback addressed, pushed to feature/min-713
> **Date:** 2026-03-05
> **Issue:** [MIN-713](https://linear.app/mind-your-now/issue/MIN-713)

---

## 1. Summary

Replace Hume EVI's bundled voice pipeline ($0.06/min) with a DIY pipeline: Deepgram Nova-3 (STT) + Kaia AI (LLM) + Hume Octave 2 (TTS). Same Kaia voice, 4.3x cheaper ($0.014/min).

## 2. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **EVI coexistence** | Replace directly, no feature flag | Owner wants clean cut, no dual pipeline complexity |
| **WebSocket endpoint** | Separate raw WS at `/ws/voice` | Voice needs binary audio frames, not STOMP text protocol |
| **Platform support** | Web + iOS + Android (Capacitor) NOW | Mobile is NOT a follow-up. Must work on all platforms from day one |
| **Audio format** | Raw passthrough to client | Server should NOT transcode. Hume Octave audio goes direct to client via WebSocket |
| **Mobile audio capture** | WebView VAD (@ricky0123/vad) | Same code path for web and Capacitor WebView. Fix issues if they arise |
| **Emotion detection** | Drop for now | No emotion context in DIY pipeline v1. Can add Hume Expression Measurement later |
| **Kaia voice identity** | Agent discovers from Hume Voice Library | Check current EVI config and match voice in Octave |
| **API keys** | Trust DEEPGRAM_API_KEY is configured | Already set in `~/.myn/.env` and K8s secrets |
| **Task slicing** | One big implementation task | Full context in one session, agent makes decisions in flow |

## 3. Architecture

```
Client (Web/Capacitor)
  Microphone -> @ricky0123/vad (VAD) -> Audio chunks
       |                                     |
       | WebSocket (wss://{host}/ws/voice)   |
       v                                     v
Backend (Spring Boot) - VoiceOrchestrator
  |
  +-> Deepgram Nova-3 (STT, WebSocket streaming, $0.008/min)
  |     - wss://api.deepgram.com/v1/listen
  |     - interim_results=true, utterance_end_ms=1000
  |     - Returns partial + final transcripts
  |
  +-> Kaia AI (Spring AI, AIService.getChatResponseStream())
  |     - Claude 3.5 Haiku via existing ChatClient
  |     - Flux<String> streaming tokens
  |     - Filter internal events before TTS
  |
  +-> SentenceChunker (new, buffer tokens into sentences)
  |     - Don't wait for full response
  |     - Send each sentence to TTS immediately
  |
  +-> Hume Octave 2 (TTS, streaming REST, $0.006/min)
        - POST /v0/tts/stream/json
        - instant_mode=true (~200ms first audio)
        - Audio chunks -> WebSocket -> client speaker
```

## 4. WebSocket Protocol

**Endpoint:** `wss://{host}/ws/voice?token={jwt}`

### Client -> Server
| Type | Payload | Description |
|------|---------|-------------|
| `config` | `{ sampleRate, encoding }` | Audio format (sent once on connect) |
| `audio_start` | `{ conversationId? }` | User started speaking, open STT |
| `audio` | Binary PCM frames | Raw audio from microphone |
| `audio_end` | `{}` | User stopped speaking |
| `interrupt` | `{}` | Barge-in: cancel all in-flight ops |

### Server -> Client
| Type | Payload | Description |
|------|---------|-------------|
| `transcript_partial` | `{ text }` | Interim STT result |
| `transcript_final` | `{ text }` | Final STT result |
| `llm_token` | `{ text }` | Streaming LLM text token |
| `llm_done` | `{ fullText }` | LLM response complete |
| `tts_audio` | Binary audio chunks | Play immediately |
| `tts_done` | `{}` | All TTS audio sent |
| `error` | `{ message, code }` | Error occurred |
| `state` | `{ state }` | listening/thinking/speaking |

## 5. New Backend Files

| File | Purpose |
|------|---------|
| `config/VoicePipelineConfig.java` | Config properties for Deepgram + Hume Octave |
| `config/VoiceWebSocketConfig.java` | Register `/ws/voice` raw WebSocket endpoint |
| `voice/VoiceWebSocketHandler.java` | WebSocket handler, routes messages, manages sessions |
| `voice/VoiceSession.java` | Per-connection state: STT, LLM subscription, TTS |
| `voice/VoiceOrchestrator.java` | Pipeline: STT -> LLM -> SentenceChunker -> TTS |
| `services/DeepgramService.java` | Deepgram Nova-3 WebSocket client |
| `services/HumeOctaveService.java` | Hume Octave 2 TTS streaming client |
| `utils/SentenceChunker.java` | Buffer LLM tokens into complete sentences |

## 6. New/Modified Frontend Files

| File | Action | Purpose |
|------|--------|---------|
| `services/VoicePipelineService.ts` | New | WebSocket client for `/ws/voice`, audio streaming |
| `hooks/useVoicePipeline.ts` | New | React hook wrapping VoicePipelineService |
| `components/voice/VoiceMode.tsx` | Modify | Replace `@humeai/voice-react` with DIY pipeline |
| `atoms/voiceModeAtoms.ts` | Modify | Add pipeline state atoms |
| `hooks/useHumeVoice.ts` | Remove | No longer needed |

## 7. What Gets Removed

### Backend
- `HumeByollmController.java` - EVI BYOLLM endpoint
- `HumeTokenController.java` - EVI token provisioning
- `HumeWebhookController.java` - EVI webhooks
- `HumeSessionSecretService.java` - EVI session secrets
- `HumeEmotionService.java` - EVI emotion composites
- Related security config entries (ApiKeyConfig, HumeByollmFilterChain)

### Frontend
- `hooks/useHumeVoice.ts` - EVI token hook
- `@humeai/voice-react` dependency
- EVI-specific code in VoiceMode.tsx

### Keep
- `HUME_API_KEY` / `HUME_SECRET_KEY` - needed for Octave TTS
- `voiceModeAtoms.ts` - UI state pattern unchanged
- Voice prompt templates (voice-additions.txt etc.)

## 8. Barge-In Strategy

1. Client-side @ricky0123/vad detects speech onset (~50-100ms)
2. Client immediately stops audio playback + clears queue
3. Client sends `interrupt` message on WebSocket
4. Server cancels: LLM Flux subscription (dispose()), Deepgram STT session (close), Hume TTS response (close)
5. Server resets session state to IDLE
6. New STT -> LLM -> TTS cycle begins

Target: <200ms from speech onset to Kaia audio stopping (all client-side).

## 9. Latency Budget

| Stage | Target | Notes |
|-------|--------|-------|
| VAD detection | 50-100ms | Client-side @ricky0123/vad |
| Audio to server | 30-50ms | WebSocket binary |
| Deepgram STT | 200-300ms | Nova-3 streaming |
| LLM TTFT | 200-400ms | Claude Haiku via Spring AI |
| Sentence chunking | ~0ms | In-memory buffer |
| Hume Octave TTS | 100-200ms | instant_mode=true |
| Audio to client | 30-50ms | WebSocket binary |
| **Total (first audio)** | **~700-1100ms** | Target: <1.5s |

## 10. Mobile (Capacitor) Considerations

- @ricky0123/vad runs in WebView (WKWebView on iOS, Android WebView)
- Web Audio API + getUserMedia available in Capacitor WebViews
- WebSocket connections work through Capacitor's web layer
- Audio playback via Web Audio API decodeAudioData works in WebView
- May need to handle iOS audio session configuration (interruption handling)
- Test on actual devices early - simulator audio behavior differs

## 11. Out of Scope

- Emotion detection from voice (add Hume Expression Measurement later)
- Multiple language support (English only for v1)
- Voice cloning / custom voice training
- Feature flag / EVI fallback

## 12. Acceptance Criteria

- [ ] User can speak to Kaia and hear a spoken response via DIY pipeline
- [ ] Barge-in: speaking while Kaia talks stops her immediately (<200ms)
- [ ] End-to-end latency <1.5s from end of user speech to first audio
- [ ] Same Kaia voice identity as current EVI implementation
- [ ] Conversation context maintained across turns (conversationId)
- [ ] Partial transcripts shown in real-time as user speaks
- [ ] AI response text streams as it generates
- [ ] Works on web (Chrome, Firefox, Safari)
- [ ] Works on mobile (iOS + Android via Capacitor)
- [ ] Graceful error handling for STT/TTS/LLM failures
- [ ] Voice mode UI (full-screen overlay + minimized pill) works as before
- [ ] EVI code removed (no dead code)

## Specialist Feedback

- **[2026-03-05T14:03Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
  - **RESOLVED**: Added 53 backend tests + 36 frontend tests
  - **RESOLVED**: Fixed thread-safety in VoiceWebSocketSession.transcriptAccumulator
  - **RESOLVED**: Fixed localStorage → tokenAtom in useVoicePipeline
  - **RESOLVED**: Error messages already fixed (no internal leakage)
- **[2026-03-06T02:47Z] test-agent → FAILED** — `.planning/feedback/002-test-agent-failed.md`
