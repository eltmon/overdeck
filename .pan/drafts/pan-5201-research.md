# Speech-to-text landscape, November 2026: what Overdeck should support

Researched 2026-11-13. Each claim cites its source inline as `[n]` (list at the end). How firm the source is varies, so each row carries a confidence marker:

- **P** = primary source fetched today (vendor docs, pricing page, model card, or the leaderboard's own data)
- **S** = secondary (third-party write-up, or a vendor search snippet I could not open)
- **U** = unverified or conflicting
- **"?"** in a cell = nothing found

"Flux" below means Overdeck's meeting sessions. Deepgram also ships a model called **Flux**; it is always written "Deepgram Flux" here.

---

## 1. Bottom line

| Use | Pick | Why |
|---|---|---|
| Flux meetings, cloud #1 | **Speechmatics Realtime (Standard $0.45/hr or Enhanced $0.80/hr)** | The only cloud stream whose docs put all three together: real-time diarization, **enrolled-speaker identification**, and a custom dictionary. Speaker ID is excluded only on Melia 1 / Oak 1, so its availability on Standard and Enhanced is inferred from that exclusion. No speaker cap. |
| Flux meetings, cloud #2 | **AssemblyAI Universal-3.6 Pro Realtime + `speaker_labels`** | Lowest streaming WER in the largest published comparison. Real-time DER ranked 3rd of 12. Mid-session `SpeakerRevision` events. 100 keyterms included. $0.57/hr with diarization. Capped at 10 speakers; streaming diarization is beta. |
| Flux meetings, cloud #3 | **Meta Muse Voice Transcribe** (`DIARIZATION` mode) | Best real-time DER even in a competitor's benchmark. 20+ speakers, keyword biasing, $0.18/hr. Gaps: no enrollment, turn-level timestamps only, overlapping speech is not handled. |
| Flux meetings, cloud #4 | **Mistral Voxtral Mini Transcribe Realtime 3** | Real-time diarization **with up to 8 enrolled reference clips**. $0.48/hr. Gaps: public preview, no timestamps on real-time segments, and diarization can't be combined with turn detection. |
| Watch list | ElevenLabs Scribe v3 Live (launched 2026-11-10), xAI Grok STT, Soniox stt-rt-v6 | Each streams with diarization at $0.12–0.38/hr. Too new, too thinly documented, or (Soniox) a weak DER in the one comparison that exists. |
| Local, RTX 3090 | **NVIDIA NeMo-Speech.cpp `serve`**, running Nemotron Speech Streaming ASR + **Nemotron 3 Diarization** (8 speakers, streaming) | One native C++ server with a real-time WebSocket that takes `speaker_diarization` and `speech_contexts` word boosting. No Python, GGUF weights. |
| Local, CPU-only | NeMo-Speech.cpp streaming ASR, plus a **rolling re-diarization pass** with `sherpa-onnx-node` (pyannote segmentation-3.0 + speaker embeddings, which also covers enrollment) | NeMo ASR is published at 6x real time on CPU. No CPU speed is published for Nemotron 3 Diarization, so measure it before relying on it live. |
| Dictation | Cloud: **AssemblyAI Universal-3.6 Pro Realtime**. Local: **keep Moonshine** (CPU, MIT), with Nemotron streaming via NeMo-Speech.cpp as the GPU and word-boost upgrade | See §6c. |
| Keep Moonshine? | **Yes**, for dictation. It is English-only and the sidecar package is linux-x64 only, so macOS has no local path today. | |
| Keep Google Cloud? | **Keep, but freeze it.** It has no role in Flux. | The integration is the legacy v1p1beta1 client. Chirp 3 (V2-only) has no streaming diarization, Gemini 3.5 Transcribe Live has none either, and streams are capped at 5 minutes. |

---

## 2. Where diarization is batch-only

Any engine in this list would need a **rolling re-diarization pass** to serve Flux: buffer the audio, re-diarize every N seconds, and remap the labels on turns already emitted.

| Engine | Real-time status | Source |
|---|---|---|
| Google **Chirp 3** | Streaming ASR yes. Diarization is "Available only in Speech.BatchRecognize" (the language table also lists Recognize). | [G1] |
| Google **Gemini 3.5 Transcribe Live** | Live model has no diarization. The file model diarizes up to 8 speakers (3+ marked experimental). Live sessions are capped at 10 minutes. | [G2] |
| OpenAI **gpt-live-transcribe** | "doesn't return word-level timestamps, speaker labels, or transcription confidence scores." | [O2] |
| OpenAI **gpt-4o-transcribe-diarize** | Not supported in Realtime sessions. File-only. Deprecated, shutting down **2027-02-26**. | [O1] |
| **Gladia** | Pricing page marks speaker diarization "Async only" on every plan. | [GL1] |
| Microsoft **MAI-Transcribe-2-Streaming** | Microsoft's comparison says the streaming variant lacks diarization; the batch MAI-Transcribe-2 has it. (S) | [M1][M2] |
| **Deepgram v2 diarizer** | Batch only (streaming returns 400). Streaming still uses the v1 diarizer. **Deepgram Flux** appears to have no diarization: its feature overview omits it and third-party pages say so (S/U). | [D1][D2][D4][D6] |
| **Rev.ai** streaming | Only `enable_speaker_switch` (detects a change of speaker). No speaker labels. | [R1] |
| **Groq** Whisper | File transcription API. I found no streaming endpoint and no diarization. | [GQ1] |
| **WhisperX** | File-based pipeline using pyannote community-1. | [L7] |
| **pyannote community-1** (open) | File or in-memory only. The model card does not mention streaming. | [L5] |
| **sherpa-onnx** diarization | Offline (`OfflineSpeakerDiarization`) in the Node addon. | [L9] |

Real-time diarization **is** available from: AssemblyAI, Speechmatics, Deepgram Nova-3 (v1 diarizer), Meta Muse, Mistral Voxtral Realtime 3, ElevenLabs Scribe v3 Live, Soniox, Azure ConversationTranscriber, AWS Transcribe Streaming, xAI Grok STT, pyannoteAI Live-1 (diarization only, no ASR), and locally NVIDIA Streaming Sortformer / Nemotron 3 Diarization and diart.

---

## 3. Cloud streaming APIs

Prices are list pay-as-you-go streaming rates, converted to $/audio-hour. "+diar" is the diarization add-on. Languages are approximate counts.

| Provider / model | Streaming | Real-time diarization (max speakers) | Speaker ID / enrollment | Custom vocab | Latency | Streaming $/hr | Langs | Node integration | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| **AssemblyAI Universal-3.6 Pro Realtime** (`universal-3-6-pro`, 2026-09-29) | Yes, WebSocket | **Yes, beta**: per-turn `speaker_label` and per-word `speaker`; `SpeakerRevision` messages (mid-session every ≥120 s, plus final); `max_speakers` 1–10 | Not in streaming. Batch speaker ID is +$0.02/hr. | Keyterms, up to 100 included; prompts can change mid-session | ~150 ms P50 / 240 ms P90 after VAD endpoint (published for U3 Pro RT) | **0.45 + 0.12 diar = 0.57** | 32 | WebSocket + JS SDK, 16 kHz PCM (?) | P [A1][A2][A3] |
| AssemblyAI Universal-Streaming EN / Multi | Yes | Yes (same mechanism) | No | Keyterms up to 100 (+$0.04/hr EN) | not published here | 0.15 + 0.12 (+0.04) | EN / multi | same | P [A1][A2] |
| AssemblyAI Slam / async | Not streaming. The current pricing page lists only Universal-3.5 Pro and Universal-2 for async; **Slam no longer appears**. | | | | | | | | P [A1] |
| **Speechmatics Realtime** (Standard / Enhanced) | Yes, WebSocket | **Yes**. `max_speakers` default unlimited (≥2); `speaker_sensitivity`, `prefer_current_speaker` | **Yes, real-time**: `get_speakers` returns identifiers; pass `speakers:[{label, speaker_identifiers}]` next session. Excluded only on Melia 1 / Oak 1 (so available on Standard and Enhanced by inference). | Custom dictionary (Enhanced, Standard, Linden) | not published | **Standard 0.45 / Enhanced 0.80** (Melia 1 0.40, Linden 1 0.30 promo) | 55+ | WebSocket; JS SDK (?) | P [S1][S2][S3] |
| **Meta Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, 2026-09) | Yes, `wss://api.meta.ai/v1/asr/realtime` | **Yes**, "20+ speakers", non-overlapping speech only. Mode (`PUSH_TO_TALK` / `ENDPOINTING` / `DIARIZATION`) is fixed at handshake. Labels are session-scoped; turn-level timestamps. | No | `keywords` (no stated limit) | Adaptive delay; no ms figure | **0.18** | 25+ | Raw WebSocket (Python cookbook only); PCM16 mono at 24 kHz or 16 kHz | P [ME1], S [ME2] |
| **Mistral Voxtral Mini Transcribe Realtime 3** (2026-10-20, public preview) | Yes, WebSocket | **Yes**, `diarize:true`. References plus predicted speakers ≤ 10. Real-time segments have `start`/`end` = null. Errors if combined with turn detection. | **Yes**: up to 8 reference clips of 3–15 s; each clip's name becomes the `speaker_id` | Context biasing on batch models; for real-time I found no doc (U) | "Sub-500ms" | **0.48** ($0.008/min) | 35+ | Raw WebSocket (the SDK doesn't send `diarize`); `pcm_s16le` 16 kHz | P [MI1][MI2] |
| **ElevenLabs Scribe v3 Live** (2026-11-10) | Yes, WebSocket | **Yes**, new: `diarize=true`; draft labels in partials, a diarized transcript after each commit, `speakers_merged` revisions. Max speakers not documented. | No | Keyterm prompting +$0.08/hr; keyterm library up to 10,000 terms +$0.08/hr | ~150 ms (product page) | **0.22** (+0.08 +0.08) | 90+ | WebSocket; PCM 8–48 kHz; SDK (?) | P [E1][E2][E3]. The product page contradicts this ("diarization isn't a priority"), likely stale [E4]. `speakers_merged` is S [E5]. |
| ElevenLabs Scribe v2 Realtime | Yes | Not listed | No | 50 keyterms | not published | 0.22 | 90+ | same | P [E1][E2] |
| **Deepgram Nova-3** | Yes, `/v1/listen` | Yes, **v1 diarizer only** (v2 is batch-only); only the `speaker` index is returned | No | Keyterm prompting +$0.078/hr | not published here | 0.29 (promo) / 0.46 (list) + 0.12 diar | ? | WebSocket + JS SDK (?) | P [D1][D2][D3]; U on promo end date [D5] |
| **Deepgram Flux** (`flux-general-en`/`-multi`, `/v2/listen`) | Yes, with model-integrated end-of-turn | Probably **no** (omitted from the feature overview; third-party pages say none) | No | Keyterms | ~260 ms end-of-turn detection | 0.39 (promo) | EN + 10 | WebSocket | P [D3][D4]; diarization S/U [D6] |
| **Soniox stt-rt-v6** (2026-11-03) | Yes, sessions up to 5 h | Yes, up to 15 speakers; per-token `speaker`, labels "can briefly switch and then settle" | No ("does not identify who a speaker is") | Structured `context` | not published | **~0.12** incl. diarization (token-billed) | 60+ | WebSocket; SDK (?) | P [SO1][SO2] |
| **xAI Grok STT** (Grok Voice Transcribe 2.0, 2026-09-18) | Yes, WebSocket | "word-level speaker IDs" in "real-time streaming" | No | Key terms (S) | not published | **0.20** | 25+ | WebSocket | P [X1], S [X2] |
| **Azure AI Speech** ConversationTranscriber | Yes | Yes: `Guest-1`, `Guest-2`; intermediate results labelled if `DiarizeIntermediateResults=true` | Speaker Recognition retired Sept 2025 (S) | Phrase lists | not published | ~1.00 + 0.30 diar (S) | ? | `microsoft-cognitiveservices-speech-sdk` (npm) | P [AZ1]; S [AZ2][AZ3] |
| **AWS Transcribe Streaming** | Yes | Yes (speaker partitioning). Medical docs say it works best with 2–5 speakers. | No | Custom vocabulary included | not published | **0.60** ($0.01/min, includes diarization) | ? | AWS SDK (?) | P [AW1][AW2] |
| Google **Chirp 3** (V2) | Yes (5-min streams) | **No, batch only** | No | Adaptation, 1,000 phrases | not published | ~0.96 ($0.016/min standard, S) | 111 locales | gRPC client | P [G1]; S [G3] |
| Google **Gemini 3.5 Transcribe Live** | Yes (10-min sessions) | **No** | No | 1,000 terms | not published | not listed | 85+ | Gemini Live API | P [G2] |
| **OpenAI gpt-live-transcribe** | Yes, `v1/realtime/transcription_sessions` | **No** | No | `prompt` + `keywords` | Tunable `delay` (minimal…xhigh) | **1.02** ($0.017/min) | ? | WebSocket; **PCM16 at 24 kHz** in examples; no server VAD (client must commit) | P [O2][O3] |
| OpenAI gpt-4o-transcribe-diarize | File streaming only | Batch only | Up to 4 known-speaker clips (2–10 s) | No prompts | n/a | 0.36 (S) | ? | REST | P [O1] |
| **Microsoft MAI-Transcribe-2-Streaming** (preview, 2026-10-01) | Yes | No (S) | No | No (S) | Words ~320 ms after speech | 0.54 (introductory, through 2026-12-31) | 60 | Foundry | P [M1], S [M2] |
| **Gladia** real-time | Yes | **Async only** | No | Custom vocabulary | ~103 ms partial / ~270 ms final (S) | €0.68 | 100+ | WebSocket | P [GL1]; latency S [GL2] |
| **pyannoteAI Live-1** (beta, 2026-11-05) | Diarization-only stream (no ASR); 16 kHz, 100 ms chunks | Yes, max 8 speakers, "same accuracy as Precision-2" | Voiceprints exist (batch); in streaming, unverified (U) | n/a | ~300 ms diarization | €0.198/h (beta free) | any | WebSocket | P [PY1][PY2] |
| **Rev.ai** streaming | Yes | Speaker switch only | No | Custom vocabulary | not published | not found | 9 (S) | WebSocket | P [R1] |
| **Cartesia Ink-2** | Yes | No (S) | No | ? | ? | ~0.40 (S) | 5 | WebSocket | S [CA1][CA2] |
| **Fireworks** streaming ASR v2 | Yes, WebSocket | "Streaming speaker diarization" announced as closed beta (S) | No | ? | ~300 ms (S) | ~0.21 (S) | ? | WebSocket | S/U [F1][F2] |
| **Groq** Whisper large-v3-turbo | No (file API) | No | No | Prompt | n/a | 0.04 (batch) | ? | REST | P [GQ1] |

### Accuracy evidence for streaming

There is **no independent real-time diarization benchmark**. Every real-time DER number below was run by a vendor with a stake in the result. Treat them as directional, and run Overdeck's own bake-off (§7).

**AssemblyAI benchmark snapshot, 2026-09-16** (vendor-run, same audio and scoring for every system) [A4]:

| System | Voice-agent WER | Short-form EN WER | Long-form EN WER | Real-time DER |
|---|---|---|---|---|
| AssemblyAI U3.6 Pro RT | **5.19** | **3.44** | 8.82 | 16.0 (16.68 in the position table) |
| Soniox RT | 6.83 | 7.60 | 8.19 | 31.8 |
| Meta Muse | 7.48 | 6.20 | **7.37** | **14.5** |
| ElevenLabs Scribe v2 RT | 7.78 | 5.13 | 17.12 | n/a |
| Speechmatics Enhanced RT | 8.14 | 4.69 | 8.08 | 22.2 |
| Gemini 3.5 Transcribe Live | 8.48 | 5.04 | 9.42 | n/a |
| AWS Transcribe Streaming | 8.58 | 3.93 | 8.71 | 27.5 |
| Deepgram Nova-3 | 8.64 | 7.46 | 9.75 | 34.0 |
| Deepgram Flux EN | 13.50 | 6.53 | 9.59 | n/a |
| Azure | n/a | n/a | n/a | 20.4 |
| xAI | n/a | n/a | n/a | 25.7 |
| Gladia Solaria | 16.25 | 7.01 | 10.72 | n/a |
| OpenAI GPT-4o Transcribe | 18.37 | 8.11 | 27.45 | n/a |

Meta has the best DER here even though a competitor ran the test, which makes that result more credible than a self-reported one.

**Other vendor claims:**

- **Mistral** (diarization cpWER, batch): Voxtral Small 18.4, Mini 18.6, Pyannote orchestration 19.0, Scribe v2 23.0, Gemini 3.5 Transcribe 38.4 [MI1].
- **ElevenLabs** (real-time DER, English subset of its own data, aligned before scoring): Scribe v3 Live 3.1% vs 5.9–7.3% for other real-time models [E3].
- **Meta**: Muse reported at 17.5% average DER on AMI-IHM / AMI-SDM / VoxConverse (S) [ME2].

**Artificial Analysis** (AA-WER v2 = AA-AgentTalk 50%, VoxPopuli 25%, Earnings22 25%) [AA1][AA2]:

- The non-streaming board shows Voxtral Small Transcribe 3 at 2.1%, Mini 3 at 2.2%, Whisper L-v3 at 4.1–4.5%, Parakeet TDT 0.6B v3 at 4.5%, and Whisper v3 Turbo (Groq) at 4.6%.
- The streaming board lists 49 models, but its values did not render in text.
- Meta says Muse ranked #1 on the streaming board at launch [ME1]. Microsoft says MAI-Transcribe-2-Streaming is "top-ranked" there [M1].

---

## 4. Local / open ASR models

**WER source.** The column is the Open ASR Leaderboard **v1.16.0, dated 13-11-2026**, English short-form average WER, scraped from the leaderboard's own data [L1].

- Datasets: AMI, Earnings22, Gigaspeech, SPGISpeech, URGENT24, Voice Arena, VoxPopuli, plus two private sets. **LibriSpeech has been removed**, so every number is higher than older citations.
- Numbers marked † come from model cards that use the *old* dataset mix. Don't compare them with the v1.16 column. On the old mix, Whisper large-v3 was about 7.44; on v1.16 it is 8.24.
- The leaderboard measures offline (batch) decoding, even for streaming-capable models.

| Model | Streaming | WER (v1.16) | RTFx | Diarization | Custom vocab | Langs | License | Hardware | Node integration | Conf. |
|---|---|---|---|---|---|---|---|---|---|---|
| **Nemotron Speech Streaming EN 0.6B** | **True streaming** (cache-aware, 80 ms–1.12 s chunks) | 7.47 | 1,116 | Pairs with Sortformer / Nemotron 3 Diarization | Word boosting via NeMo-Speech.cpp `speech_contexts` | EN | NVIDIA open license (check card) | CPU viable: 27 ms per 160 ms chunk Q8, **6x real time**; CUDA | **NeMo-Speech.cpp WebSocket** (no Python) | P [L1][L2][L3] |
| Nemotron 3.5 ASR Streaming 0.6B (2026-06) | True streaming, 80 ms–1.12 s | 11.09 (EN); FLEURS 8.84–10.38 | 1,353 | same | same | 40 locales | OpenMDW-1.1 | same | same | P [L1][L4] |
| Multitalker Parakeet Streaming 0.6B v1 | Streaming, one instance per speaker; handles overlap | cpWER AMI-SDM 37.44, CH109 15.81 | n/a | Driven by Streaming Sortformer 4spk v2.1 | No | EN | NVIDIA Open Model License | CUDA GPU, NeMo (Python) | Python sidecar; parakeet-rs (Rust) | P [L6] |
| Nemotron 3.5 Transcribe 30B-A4B | Batch | **6.13** (long-form 10.52; the open `freetranscribe/parakeet-ft-v1` is better at 9.81) | 473 | Speaker labels (batch) | Custom instructions | multi | open (check card) | Large; GGUF via NeMo-Speech.cpp | NeMo-Speech.cpp HTTP | P [L1][L2] |
| Parakeet TDT 0.6B v2 / v3 | Batch (chunked pseudo-streaming possible) | 6.93 / 7.04 | 6,148 / 6,322 | No | No (sherpa-onnx hotwords: U) | EN / 25 | open (check card) | CPU viable | sherpa-onnx-node, NeMo-Speech.cpp, parakeet-rs | P [L1][L9] |
| Canary-Qwen 2.5B | Batch | 6.92 | 882 | ? | ? | ? | ? | GPU (?) | Python (?) | WER P [L1]; rest not checked |
| IBM Granite Speech 5.0 2B (2026-10-20) | **Not streaming** (≤ ~2 min segments) | 6.68 | 548 | No | **Keyword list up to 2,000** | 6 | **Apache-2.0** | CUDA or CPU; GGUF / Ollama | Python, Ollama | P [L1][L8] |
| Qwen3-ASR-1.7B | Batch | 6.15 | 836 | ? | ? | multi (multilingual table) | ? | GPU (?) | Python (?) | WER P [L1]; rest not checked |
| Whisper large-v3 / v3-turbo | Pseudo-streaming (whisper.cpp `stream` + VAD) | 8.24 / 8.75 | 471 / 809 | whisper.cpp "tinydiarize (experimental)" | Prompt | multi (?) | ? (not checked today) | CPU-only supported; CUDA / Vulkan / Metal | whisper.cpp JS binding (npm), `whisper-server` | P [L1][L10] |
| Distil-Whisper large-v3.5 | Batch | 7.57 | 898 | No | Prompt (?) | EN | ? | ? | ? | WER P [L1]; rest not checked |
| WhisperX (faster-whisper + pyannote) | **Batch only** | (Whisper) | 70x RT on GPU | pyannote community-1 | ? | multi (?) | code ?; diarization weights CC-BY-4.0 | <8 GB GPU, or CPU int8 | Python | P [L7] |
| **Moonshine v2 streaming** tiny / small / medium (34M / 123M / 245M) | **True streaming** (sliding-window encoder, 80 ms lookahead) | Not on v1.16. †Card: 12.01 / 7.84 / **6.65** (old mix, vs Whisper L-v3 7.44) | †448 | No | No | **EN** (Moonshine Voice also lists other STT langs) | **MIT** | **CPU-first** | Already integrated (native sidecar); Moonshine Voice has JS/WASM | P [L11][L12] |
| Kyutai STT 1B en_fr / 2.6B en | Streaming, 0.5 s / 2.5 s delay | Not on v1.16. †2.6B card: 6.4 | †88 | No | No | EN / EN+FR | CC-BY-4.0 | GPU (?) | `python -m moshi.server` (Python); Transformers | P [L13] |
| Voxtral Mini 4B Realtime 2602 | True streaming, 240 ms–2.4 s (480 ms recommended) | 9.72 | 103 | No | Not documented | 13 | **Apache-2.0** | **GPU ≥16 GB** (3090 OK) | vLLM `/v1/realtime` WebSocket (Python) | P [L1][L14] |
| Voxtral 3 family | API only. **No open weights** as of 2026-11-05 | n/a | | | | | | | | S [MI3] |
| MOSS-Transcribe-Diarize, VibeVoice-ASR | Batch | 6.91 / 9.54 | | Diarization (per name; not checked) | | | open | GPU | Python | P (WER only) [L1] |

## 5. Local diarization

| Model | Streaming | Max speakers | DER (lower is better) | License | Hardware | Node integration | Conf. |
|---|---|---|---|---|---|---|---|
| **NVIDIA Nemotron 3 Diarization** (2026-09-23, 100M, Sortformer family, AOSC speaker cache) | **Yes**: 0.32 / 0.64 / 1.04 s latency configs, or offline 30.4 s | **8** | DIHARD III 13.55 @0.32 s (12.73 offline); CALLHOME-2 11.32; AMI-SDM 12.95 | OpenMDW-1.1 (commercial OK) | Listed for NVIDIA GPUs. **CPU speed not published.** | **NeMo-Speech.cpp** (`speaker_diarization:true` on the real-time WebSocket), NeMo, Transformers, GGUF | P [L2][L3][L15] |
| NVIDIA Streaming Sortformer 4spk v2 / v2.1 | Yes | 4 (degrades at 5+) | DIHARD III ~18.9–19.1 | NVIDIA open | GPU | NeMo-Speech.cpp, NeMo | P [L6][L15][L16] |
| pyannote **community-1** | **No** (file / in-memory) | `min_speakers` / `max_speakers` / `num_speakers` | AMI-IHM 17.0, AMI-SDM 19.9, DIHARD3 20.2, VoxConverse 11.2 | CC-BY-4.0 weights, MIT code | CPU default, GPU optional | Python; sherpa-onnx ports pyannote segmentation-3.0 | P [L5] |
| pyannote precision-2 / Precision-3 | Batch via API (on-prem by contract); Live-1 streams | | precision-2: AMI-SDM 15.6, DIHARD3 14.7 | Commercial | | REST / WebSocket | P [L5][PY2] |
| **diart** | Yes, 0.5–5 s latency; `diart.serve` WebSocket | n/a | n/a | ? | CPU or GPU (?) | Python. Recommends `pyannote.audio<3.1`, so it is stale. | P [L17] |
| **sherpa-onnx-node** | Diarization offline; speaker ID / verification available | ? | n/a | ? | **CPU** (?) | **npm `sherpa-onnx-node`** (native addon): `OfflineSpeakerDiarization`, `SpeakerEmbeddingExtractor` | P [L9] |

---

## 6. Recommendations

### (a) Cloud providers to add for Flux meetings, ranked

1. **Speechmatics Realtime, Standard or Enhanced ($0.45–0.80/hr).**
   - The only cloud engine whose docs combine real-time diarization, **enrolled-voice identification** and a **custom dictionary** in one stream. Enroll once by saving `speaker_identifiers` from a solo clip; later sessions label those voices "Alice", "Bob" and so on [S1][S2].
   - No speaker cap. Mid-pack DER (22.2 in AssemblyAI's report).
   - Use Standard ($0.45/hr) or Enhanced ($0.80/hr), not Melia 1, which has neither a custom dictionary nor real-time speaker ID. That Standard and Enhanced have speaker ID is inferred: the docs exclude it only on Melia 1 and Oak 1.
2. **AssemblyAI Universal-3.6 Pro Realtime with `speaker_labels` ($0.57/hr).**
   - Best measured streaming WER, real-time DER ranked 3rd of 12 (both vendor-run), and 100 keyterms included.
   - Turn the corrections on with `speaker_labels_revision_interval_ms=120000–300000`; they arrive as `SpeakerRevision` messages [A2].
   - Limits: no enrollment, 10 speakers maximum, beta.
3. **Meta Muse Voice Transcribe ($0.18/hr).**
   - Cheapest of the four, with the best real-time DER in the one comparison it didn't run itself, plus keyword biasing.
   - A diarization session can't also do endpointing (mode is fixed at handshake), timestamps are per turn, and overlapping speech is not handled [ME1].
   - It's a good default for long, cost-sensitive meetings.
4. **Mistral Voxtral Mini Transcribe Realtime 3 ($0.48/hr).**
   - A second **enrollment-capable** real-time engine (8 reference clips) [MI2], hosted in the EU.
   - Limits: preview status, at most 10 speakers in total, no real-time timestamps, and real-time context biasing unconfirmed.

Not recommended for Flux:

- **Deepgram** (stuck on the v1 streaming diarizer, DER 34.0, second-worst of the ten systems scored; Deepgram Flux appears to have no diarization).
- **OpenAI, Google, Gladia, MAI** (no real-time diarization).
- **Rev.ai, Cartesia** (no speaker labels).

ElevenLabs Scribe v3 Live is the strongest candidate for a 5th slot after a bake-off, but it launched three days ago.

### (b) Local multi-speaker with diarization

- **RTX 3090: NeMo-Speech.cpp `nemo-speech serve`** [L2][L3].
  - Load Nemotron Speech Streaming EN 0.6B (or Nemotron 3.5 ASR Streaming for multilingual) plus Nemotron 3 Diarization.
  - Connect to `WebSocket /v1/audio/transcriptions/realtime` and send `session.update {sample_rate:16000, speaker_diarization:true, word_timestamps:true, speech_contexts:[{phrases:[...], boost:N}]}`. Words come back tagged with speakers. (The `spk:N` format is shown for the HTTP route; the real-time doc says only that words are tagged.)
  - It is a single native binary (CUDA / Vulkan / Metal / CPU builds) that Overdeck can supervise like the Moonshine sidecar, so there is no Python environment to manage.
  - Diarization covers 8 speakers, with DIHARD III DER 13.55 at 0.32 s latency.
  - **Enrollment is not built in.** Add it in Node with `sherpa-onnx-node`'s `SpeakerEmbeddingExtractor`: embed each diarized speaker's accumulated audio, cosine-match it against enrolled voiceprints, and map the speaker index to a name.
- **Python alternative on the 3090:** NeMo Multitalker Parakeet with Streaming Sortformer. It handles fully overlapping speech (one ASR instance per speaker) but needs NeMo / PyTorch. With Sortformer 4spk it covers 4 speakers [L6]; NVIDIA's integration guide pairs it with Nemotron 3 Diarization at `max_num_of_spks=8` (S) [L18].
- **CPU-only:**
  - NeMo-Speech.cpp ASR is 6x real time on CPU.
  - Nemotron 3 Diarization has no published CPU speed. Benchmark it first.
  - If it's too slow, run ASR live with **no** speaker labels, and do a **rolling re-diarization** every ~30–60 s with sherpa-onnx-node (pyannote segmentation-3.0 + embeddings, offline, CPU). Then emit label revisions for turns already sent.
  - A few seconds of latency is acceptable for Flux, so this design fits.

### (c) Dictation

- **Cloud: AssemblyAI Universal-3.6 Pro Realtime.** It has the lowest voice-agent and short-form WER in the largest comparison [A4], about 150 ms P50 after VAD (measured on its U3 Pro predecessor) [A3], keyterms included, and the same engine as the Flux pick, so one adapter serves both.
- **Lower cost alternative:** ElevenLabs Scribe v3 Live ($0.22/hr), once validated.
- **Deepgram Flux:** its main feature is end-of-turn detection, which matters little for dictation, and its voice-agent WER (13.5) is weak.
- **Local:** Moonshine streaming medium (MIT, CPU) stays the default. Nemotron Speech Streaming through NeMo-Speech.cpp is the upgrade path when a GPU is present. It offers true cache-aware streaming and word boosting for repo vocabulary, and it shares a server with the Flux local stack. Its WER (7.47 on v1.16) can't be compared directly with Moonshine's card numbers, which use the old dataset mix.

### (d) Keep Moonshine and Google?

- **Moonshine: keep.**
  - It is the only CPU-first, MIT, zero-cost dictation path, and it is already integrated.
  - Gaps: English-only streaming, no diarization, no custom vocabulary, and the sidecar package ships only `moonshine-linux-x64`, so macOS has no local engine.
  - Confirm the sidecar uses the v2 streaming models. The v2 medium card claims 6.65 against Whisper L-v3's 7.44 on the old Open ASR mix [L11].
- **Google Cloud: keep it working, but don't invest further.**
  - `src/voice/google-cloud-transcription.ts` uses the legacy `v1p1beta1` / `v1` `streamingRecognize` at 24 kHz.
  - Chirp 3 is V2-only and diarizes only in batch [G1]. Gemini 3.5 Transcribe Live does not diarize [G2]. Streams are capped at about 5 minutes [G4], and the price is about $0.96/hr.
  - Moving to Chirp 3 means migrating to the V2 API, not changing a model string, and it would still leave Flux without speaker labels.
  - Drop it if maintenance cost appears; AssemblyAI covers the same cloud-dictation role better.

---

## 7. Design implications for Overdeck

1. **`ITurnEmitter` is text-only.** It exposes `onPartial(text)` and `onCommitted(text)` (`src/voice/transcription.ts`). Flux needs three additions:
   - committed turns carrying `{speaker, speakerConfidence?, startMs?, endMs?, words?}`;
   - an `onSpeakerRevision` / `onSpeakersMerged` event, because AssemblyAI (`SpeakerRevision`), ElevenLabs (`speakers_merged`), Soniox (label settling) and any rolling local re-diarization all revise labels already sent;
   - a downstream LLM extractor that tolerates revised labels, keyed by turn id.
2. **Label scope.** Every engine's labels (A/B, S1, Guest-1, `spk:0`) are session-scoped. Stable names across sessions need enrollment: Speechmatics identifiers, Voxtral reference clips, or local voiceprints. Store voiceprints per user in the memory home, never in the transcript.
3. **Sample rates.** The browser sends 16 kHz PCM16.
   - Confirmed to accept 16 kHz: Muse, Voxtral, Deepgram (Flux docs) and NeMo-Speech.cpp. AssemblyAI, Speechmatics and Soniox weren't checked today.
   - OpenAI real-time expects 24 kHz and needs client-side commits (no server VAD) [O3].
   - The current Google engine sets `SAMPLE_RATE = 24000`, while Moonshine uses 16000. Check that the Google path resamples.
4. **Mode conflicts.** Muse and Voxtral Realtime 3 can't run diarization and turn detection in one session. Overdeck has no VAD of its own today: `turn-queue.ts` and `ws-voice.ts` forward the engine's `onCommitted`. Flux therefore needs a server-side segmenter, such as Silero VAD or a fixed-window commit, before these two engines can deliver turns. A few seconds of latency is acceptable, so a simple one will do.
5. **Vocabulary.** Feed keyterms from the project: repo module names, issue titles, PAN-ids, people's names. Limits differ:
   - AssemblyAI: 100 terms
   - ElevenLabs: 10,000 terms (library)
   - Google / Gemini: 1,000 terms
   - Granite: 2,000 terms
   - NeMo `speech_contexts` and Speechmatics custom dictionary: no limit stated.
6. **Bake-off before committing.**
   - Record 3–5 real Overdeck meetings (2–8 speakers, in-room mic and captured call audio).
   - Hand-label 10 minutes of each.
   - Score cpWER and DER with meeteval for each candidate in §6a, and for NeMo-Speech.cpp locally.
   - The vendor numbers above conflict too much to settle the ranking on their own.

---

## Sources

**AssemblyAI**
- [A1] https://www.assemblyai.com/pricing
- [A2] https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels
- [A3] https://www.assemblyai.com/blog/universal-3-pro-streaming
- [A4] https://www.assemblyai.com/benchmarks
- Changelog (U3.6 Pro Realtime, 2026-09-29): https://www.assemblyai.com/changelog

**Speechmatics**
- [S1] https://docs.speechmatics.com/speech-to-text/realtime/speaker-identification
- [S2] https://www.speechmatics.com/pricing
- [S3] https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization
- Melia: https://www.speechmatics.com/company/articles-and-news/introducing-melia-multilingual-speech-to-text-model

**Meta**
- [ME1] https://dev.meta.ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/
- [ME2] https://venturebeat.com/technology/meta-prices-muse-voice-transcribe-at-0-18-an-hour-with-real-time-diarization-for-20-speakers-a-steal-for-enterprises

**Mistral**
- [MI1] https://mistral.ai/news/voxtral-3/
- [MI2] https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers
- [MI3] https://www.marktechpost.com/2026/10/20/mistral-voxtral-3-speech-models-voice-agent-sdk/ and https://reflektlab.ai/blog/voxtral-3/

**ElevenLabs**
- [E1] https://elevenlabs.io/docs/capabilities/speech-to-text
- [E2] https://elevenlabs.io/pricing/api
- [E3] https://elevenlabs.io/blog/scribe-v3
- [E4] https://elevenlabs.io/realtime-speech-to-text
- [E5] https://dev.to/delimitter/elevenlabs-launches-scribe-v3-and-scribe-v3-live-its-most-accurate-speech-to-text-models-yet-5e64 and https://artrealmai.com/article/elevenlabs-scribe-v3-live-diarization-turn-prediction

**Deepgram**
- [D1] https://developers.deepgram.com/changelog/2026/5/13
- [D2] https://developers.deepgram.com/docs/diarization
- [D3] https://deepgram.com/pricing
- [D4] https://developers.deepgram.com/docs/flux/quickstart and https://developers.deepgram.com/docs/flux/feature-overview
- [D5] https://api.lecsync.com/blog/lecsync-vs-deepgram-nova-3-pricing-refresh
- [D6] https://www.evalgent.com/blog/deepgram-flux-vs-nova-3

**Soniox**
- [SO1] https://docs.soniox.com/stt/models
- [SO2] https://soniox.com/speech-to-text/features/diarization

**xAI**
- [X1] https://x.ai/news/grok-stt-and-tts-apis
- [X2] https://unite.ai/xai-releases-grok-voice-transcribe-2-0-speech-to-text-model/

**Azure**
- [AZ1] https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-stt-diarization
- [AZ2] https://www.developersdigest.tech/models/speech/azure
- [AZ3] https://www.memobog.net/en/blog/2026-08-21-azure-ai-speech-speaker-diarization/
- Release notes: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/releasenotes

**AWS**
- [AW1] https://aws.amazon.com/transcribe/pricing/
- [AW2] https://docs.aws.amazon.com/transcribe/latest/dg/conversation-diarization-streaming-med.html

**Google**
- [G1] https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
- [G2] https://aistudio.google.com/docs/models/gemini-3.5-transcribe
- [G3] https://cloud.google.com/speech-to-text/pricing
- [G4] https://docs.cloud.google.com/speech-to-text/docs/quotas

**OpenAI**
- [O1] https://developers.openai.com/api/docs/guides/speech-to-text
- [O2] https://developers.openai.com/api/docs/guides/realtime-transcription
- [O3] https://developers.openai.com/api/docs/models/gpt-live-transcribe and https://developers.openai.com/api/docs/pricing

**Microsoft MAI**
- [M1] https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/build-expressive-voice-experiences-with-new-mai-models-in-microsoft-foundry/4524637
- [M2] https://www.layer3labs.io/guides/microsoft-mai-models

**Other cloud**
- [GL1] Gladia: https://www.gladia.io/pricing
- [GL2] Gladia: https://www.gladia.io/blog/best-real-time-stt-models-for-meeting-assistants-2026
- [PY1] pyannoteAI: https://www.pyannote.ai/changelog/streaming-diarization-beta
- [PY2] pyannoteAI: https://www.pyannote.ai/pricing
- [R1] Rev.ai: https://docs.rev.ai/api/streaming/
- [CA1] Cartesia: https://www.cartesia.ai/ink
- [CA2] Cartesia (via Soniox comparison): https://soniox.com/compare-stt/soniox-vs-cartesia
- [F1] Fireworks: https://x.com/FireworksAI_HQ/status/1971302428457959622
- [F2] Fireworks: https://www.baseten.co/blog/the-fastest-whisper-transcription-with-streaming-and-diarization
- [GQ1] Groq: https://console.groq.com/docs/model/whisper-large-v3-turbo

**Benchmarks**
- [AA1] https://artificialanalysis.ai/speech-to-text/non-streaming
- [AA2] https://artificialanalysis.ai/speech-to-text/streaming
- [L1] Open ASR Leaderboard v1.16.0 (13-11-2026): https://huggingface.co/spaces/hf-audio/open_asr_leaderboard (data read from the Space's Gradio config, https://hf-audio-open-asr-leaderboard.hf.space/config; version registry in the Space's `init.py`)

**Local models and runtimes**
- [L2] https://github.com/NVIDIA/NeMo-Speech.cpp
- [L3] https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md (real-time WebSocket fields `speaker_diarization`, `speech_contexts`) and docs/server.md
- [L4] https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- [L5] https://huggingface.co/pyannote/speaker-diarization-community-1
- [L6] https://huggingface.co/nvidia/multitalker-parakeet-streaming-0.6b-v1
- [L7] https://github.com/m-bain/whisperX
- [L8] https://huggingface.co/ibm-granite/granite-speech-5.0-2b
- [L9] https://github.com/k2-fsa/sherpa-onnx (README and nodejs-addon-examples/README.md)
- [L10] https://github.com/ggml-org/whisper.cpp
- [L11] https://huggingface.co/UsefulSensors/moonshine-streaming-medium
- [L12] https://github.com/moonshine-ai/moonshine and https://arxiv.org/pdf/2602.12241
- [L13] https://huggingface.co/kyutai/stt-2.6b-en
- [L14] https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
- [L15] https://huggingface.co/nvidia/Nemotron-3-Diarization
- [L16] https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2
- [L17] https://github.com/juanmc2005/diart
- [L18] https://huggingface.co/nvidia/Nemotron-3-Diarization/blob/main/ASR_INTEGRATION_GUIDE.md
- parakeet-rs: https://github.com/altunenes/parakeet-rs
