# Follow-up research, November 2026: tldraw, NeMo-Speech.cpp, STT popularity, STT leaderboards

Researched 2026-11-13. This extends `pan-5201-research.md` in this folder. Confidence markers follow that file:

- **P** = primary source fetched today (vendor docs, raw page HTML, npm/HF/GitHub API, the leaderboard's own embedded data)
- **S** = secondary (third-party write-up, or a summary I could not verify against the raw page)
- **U** = unverified or conflicting

Source IDs are new to this file (`[T*]` tldraw, `[N*]` NeMo-Speech.cpp, `[POP*]` popularity, `[B*]` benchmarks). The full list is at the end.

---

## 0. Corrections to the prior survey

1. **The Artificial Analysis (AA) streaming values are now extracted.** The prior file said they "did not render". The page embeds them as JSON, and all 49 rows are in §4.2. They change the picture:
   - **Speechmatics Realtime Enhanced is near the bottom** of AA streaming (8.05% AA-WER, 46th of 49). Speechmatics' newer **Linden 1** ("Agent STT") scores 4.42%.
   - AssemblyAI U3.6 Pro Realtime is mid-pack on AA (3.57–3.85%). MAI-Transcribe-2-Streaming leads at 2.51%.
2. **An independent-looking diarization leaderboard exists.** Voice Arena Diarization-Bench covers 139 sessions and 22 h of English. **Nemotron 3 Diarization is #1 at 14.72% DER** (0 ms collar). The operator's funding and affiliations are undisclosed, and the page does not label each row as real-time or offline. The prior file's "no independent real-time diarization benchmark" still holds for *real-time*, but not for diarization in general.
3. **Model licenses, now exact** [N4]:
   - Nemotron Speech Streaming EN 0.6B: NVIDIA Open Model License.
   - Nemotron 3.5 ASR Streaming 0.6B and Nemotron 3 Diarization: OpenMDW-1.1.
4. **macOS has a local path.** NeMo-Speech.cpp ships a prebuilt `macos-aarch64-metal` archive with the server, so Moonshine is not the only option on a Mac.
5. **The Moonshine HF org moved** from `UsefulSensors/` to `moonshine-ai/` (for example `moonshine-ai/moonshine-streaming-medium`, MIT).
6. **The Pipecat STT benchmark is now being acquired by a vendor.** Deepgram announced on 2026-10-29 that it is acquiring Daily, which makes Pipecat. The Pipecat benchmark page now carries the banner "The Pipecat team is joining Deepgram and staying open source and vendor neutral" [B6][B7].
7. **The Picovoice benchmark challenges "keep Moonshine as the CPU default"** [B9]:
   - Moonshine Medium streaming: 10.6% WER, 336 core-hours per 100 h of audio.
   - Nemotron 3.5 ASR Streaming: 7.8% WER, 243 core-hours.
   - So Moonshine Medium is worse on both. The benchmark is vendor-run and LibriSpeech-heavy (see §4).
8. **NeMo is now `NVIDIA-NeMo/Speech` on GitHub.** `NVIDIA/NeMo` redirects there.
9. **The Open ASR Leaderboard (v1.16.0) lists closed API models** alongside open ones, with no RTFx for the closed rows. Examples: zoom/scribe_v2.1_pro (#1 at 4.87), OtterAI/speech-v3.1, microsoft/azure-speech-09-2026, assemblyai/universal-3-5-pro. The prior file's §4 used it only for open models [B1].

---

## 1. tldraw for Overdeck (React 18 dashboard, public OSS repo, live agent-drawn architecture diagrams)

### 1.1 Version, React, packages (P)

| Item | Value | Source |
|---|---|---|
| Latest stable | **tldraw 5.6.0**, published 2026-10-28. 5.7.0 canaries are publishing daily (latest 2026-11-13). | npm registry [T1] |
| 5.0 | Published 2026-05-06. It added the Mermaid package and the Driver package. | npm [T1], blog [T9] |
| Versioning | Not semver: "Minor releases may contain breaking changes" | [T2] (S, via search of docs) |
| **React requirement** | `peerDependencies: react ^18.2.0 \|\| ^19.2.1` on `tldraw`, `@tldraw/sync`, `@tldraw/sync-core` and `@tldraw/mermaid`. **React 18.2+ is supported.** React 19 is not required. | npm [T1] |
| Agent starter template | Its own `package.json` pins `react ^19.2.1`. The SDK still accepts 18, so porting the template's client code into a React 18 app is a compatibility exercise, not a blocker (U, untested). | GitHub [T12] |
| Weekly downloads | `tldraw` had 672,672 npm downloads in 2026-11-06..12. The pricing page says "51.4K" GitHub stars. | npm [T1], [T5] |

npm packages (all at 5.6.0 unless noted; all `SEE LICENSE IN LICENSE.md`):

- `tldraw`: editor and UI. It depends on `@tldraw/driver` and `@tldraw/editor`.
- `@tldraw/editor`: core editor without the default UI.
- `@tldraw/sync`: `useSync` client hook ("multiplayer sync react bindings").
- `@tldraw/sync-core`: `TLSocketRoom`, `InMemorySyncStorage`, `SQLiteSyncStorage`.
- `@tldraw/mermaid`: "Mermaid diagram to tldraw shape conversion." Depends on `mermaid`.
- `@tldraw/driver`: "Imperative API for driving the tldraw editor programmatically."
- `@tldraw/ai`: **stale**. Last version 3.15.4, published 2025-08-28, never moved to 4.x or 5.x. Treat it as abandoned in favour of the agent starter kit.
- `@tldraw/agent` does not exist on npm.

### 1.2 AI features

| Thing | What it is | Form | Status | Source |
|---|---|---|---|---|
| **Agent starter kit** | Chat panel plus an agent that **reads the canvas** (viewport screenshot, simplified shape data, chat history) and **edits it through typed action schemas**. Actions: create, update and delete shapes; pen strokes; rotate, resize, align, distribute, stack, reorder; move the viewport; keep a todo list; schedule follow-up work; call external APIs. "Modes" gate what it can see and do. Programmatic entry is `agent.prompt(...)`. | **Template to copy** (`npm create tldraw@latest -- --template agent`), not a package. Code is **MIT** (`templates/agent/LICENSE.md`); the SDK it uses stays under the tldraw license. | Current | P [T6][T12] |
| LLM providers in the kit | Anthropic, OpenAI, Google, through the Vercel AI SDK (`ai ^5`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`). "We recommend Anthropic for best results." Models are listed in `shared/models.ts`. | | | P [T6][T12] |
| Kit architecture | `client/`, `worker/`, `shared/`. `wrangler.toml` and `worker/do/AgentService.ts` mean **Cloudflare Workers / Durable Objects**. The LLM call runs server-side in the worker, while canvas edits apply in the browser editor. | | | P (file listing) [T12] |
| **MCP App** | Official. Hosted at `https://tldraw-mcp-app.tldraw.workers.dev/mcp` (S). The README lists the tools **`search`** (queries the Editor API spec) and **`exec`** ("runs JavaScript against the live editor in the widget"), plus app-only `_exec_callback`, `save_checkpoint` and `read_checkpoint`. Cloudflare Worker plus a Durable Object (SQLite). Up to 50 checkpoints per session; a session self-destructs after 7 days idle. Code is **MIT** (`apps/mcp-app/LICENSE.md`), deployable with `pnpm run deploy`. The launch blog (2026-03-03) described "three main tools" (create, edit, delete); the current README supersedes it. This session's own `mcp__tldraw__exec` / `mcp__tldraw__search` tools match the README. | MCP App (an MCP server plus a sandboxed HTML widget) | Clients: Claude desktop and web, Cursor; ChatGPT "coming soon" | P [T7][T8][T4] |
| Broader MCP server | FAQ, verbatim: "We don't yet have a broader MCP server for tools like Claude Code!" | | None | P [T4] |
| **Driver** (`@tldraw/driver`) | "wraps an Editor with an imperative, fluent API for simulating user input, using only public editor methods." It covers pointer, keyboard, selection transforms, clipboard and `getLastCreatedShape(s)`. A search summary of the 5.0 post says it targets MCP and AI use. It needs a live `Editor`. | Package | 5.x | P [T10], S [T9] |
| Make Real | Sketch-to-UI. FAQ: "The repo has been archived since February 2026." | Archived | Dead | P [T4] |
| tldraw computer, Fairies | Fairies are multi-agent canvas characters (fairies.tldraw.com). FAQ: "The code for Computer and Fairies is not publicly available." Teach "moved into our agent starter." | Hosted experiments | Closed source | P [T4]; Fairies details S [T13] |
| tldraw offline (2026-07-16) | Free desktop app. Per a summary of the launch post, local agents (Claude Code, Codex, Pi) can access, edit and add scripts to `.tldraw` files through a local port that accepts raw JavaScript and runs it in the editor's context. | App, not SDK | Current | S (fetch summary) [T11] |
| Other kits | chat, branching-chat, workflow (node pipelines with an `LLMNode`), image-pipeline | Templates | | P [T6][T12] |

### 1.3 How an external (server-side) agent can create and edit shapes

There is **no official headless server-side Editor**. These are the official paths:

| Path | Needs a live browser `Editor`? | Fit for Overdeck |
|---|---|---|
| **A. Exec bridge** (the MCP App pattern): the server queues JS or structured ops, and the browser widget runs them against `editor` and returns the result | Yes | Best fit. Overdeck already has `/ws/rpc`. An Overdeck MCP tool `diagram.exec` / `diagram.apply` would relay to the open dashboard tab. The MCP App source is MIT and can be copied. |
| **B. Agent-kit action schema**: the LLM emits typed actions (`create`, `update`, `align`…) and the client applies them | Yes (applied client-side) | Good. Typed actions are safer than raw JS. MIT template. |
| **C. `@tldraw/sync-core` `TLSocketRoom.updateStore`** on the server | **No.** It writes records straight into the authoritative room; connected clients receive them. | Possible. You must write raw `TLShape` / binding records yourself (no geometry, text measurement or arrow-binding helpers). The sync docs say `onCommittedChanges` fires only for client pushes, not for `updateStore`. Sync is self-hostable on any WebSocket backend (Node example) or Cloudflare. |
| **D. Mermaid import** (`createMermaidDiagram(editor, text)`) | Yes | Easiest way for an LLM to produce a whole diagram in one shot. See §1.4. |

Sources: [T7][T8][T10][T14].

### 1.4 Mermaid and auto-layout (P)

`@tldraw/mermaid` (official, since 5.0) [T15]:

- **What it produces.** "creates real geo shapes, arrows, and groups on the canvas," so the result is native and editable.
- **Supported diagram types:** flowchart/graph, sequenceDiagram, stateDiagram(-v2), mindmap.
- **Unsupported:** pie, gantt, class, ER. C4 and architecture-beta are not on the supported list either. An `onUnsupportedDiagram` callback can fall back to importing Mermaid's rendered SVG, which is not editable.
- **Errors.** Parse failures throw `MermaidDiagramError`.
- **Layout comes from Mermaid itself.** `mermaidConfig` overrides "Mermaid's layout settings, such as node spacing or font size."
- **Output.** "The finished diagram is a single group." Subgraphs become geo rectangles with their child shapes parented to them.
- **Updates.** **No in-place update API is documented.** Revising a diagram means deleting the group and re-importing it, or diffing the result yourself.
- **Size.** The `mermaid` dependency is about 2 MB and loads lazily.

Other layout options:

- There is no official dagre or ELK integration. The only tldraw-specific layout project found is the community `OrionReed/tldraw-graph-layout`, which uses a WebCola force layout (S) [T16].
- For incremental "move these boxes" revisions, the practical approach is to run elkjs or dagre yourself on the shape graph, then `editor.updateShapes`.

### 1.5 License (exact terms, quoted from raw pages)

**`LICENSE.md` (repo root, applies to all `@tldraw/*` SDK packages)** [T3]:

> "Development Environment" means any internal hosting or deployment of the Software for development, testing, or staging purposes, operated by your organization and not accessible to end users, customers, or the public.
>
> "Production Environment" means any production deployment of the Software that operates on servers, cloud platforms, web applications, or where the software is used to provide functionality to end users, customers, or the public.
>
> Conditions: … Not to use the Software in Production Environments. Not to disable, change, or interfere with the Software's License Key enforcement. … Not to make the Software available under a license that supersedes or negates the effect of this License. Not to distribute the Software … as a standalone product, but only as part of another application. To include a verbatim copy of this License in any distribution of the Software.
>
> Technical enforcement: The Software includes technical measures to verify License Key validity, detect deployment environments, enforce usage restrictions based on license type, and ensure proper watermark display.

**tldraw.dev/community/license** (the page footer says "Last edited on Sep 13, 2023", but its content describes the current key, trial and hobby system) [T2]:

> Under its default terms, the tldraw SDK license permits use only in development. To use the tldraw SDK in production, you need one of the following: a trial license for evaluation, a commercial license for commercial projects, a hobby license for non-commercial projects. … The SDK will work in production only when provided with a valid and active license key.
>
> You can get a free 100-day trial license … You are allowed only one trial license per commercial unit.
>
> For non-commercial projects, we also provide a discretionary hobby license. … When using the tldraw SDK under a hobby license, the "made with tldraw" watermark must be shown on the canvas.
>
> **Notes on open source:** … If you wish to include tldraw in an open source project, you may do so but the SDK itself must remain under its original license. **This means that you and your downstream users will require their own trial, commercial, or hobby license in order to use the SDK in production.**

**tldraw.dev/sdk-features/license-key** (last edited 2026-01-31) [T17]:

- License types:

  | Type | Watermark | Duration | Purpose |
  |---|---|---|---|
  | Trial | No | 100 days | Evaluate |
  | Commercial | No | Annual | Production in commercial apps |
  | Hobby | **Yes** | Varies | Non-commercial |

- "Each key encodes the allowed hosts (the domains where the license is valid)…" "If you deploy to a domain not covered by your license, the SDK treats it as unlicensed."
- Without a key in production, "the SDK logs errors to the console and, after five seconds, stops rendering the editor."
- Data collection table: Commercial "None"; Hobby and Trial "License ID, license type, SDK version, and page URL"; **Unlicensed "SDK version and page URL (production only)"**. This conflicts with the license page, which says "When using the tldraw SDK under a commercial or hobby license, no information is sent to tldraw." The FAQ sides with the license-key page ("from our hobby license watermark in production").
- Domains: the license-key page says "Some enterprise licenses allow `*` for any domain." The FAQ says "Do I need separate licenses for different domains? Nope! We map all relevant domains you plan to host the SDK on to a single license."

**Hobby page** [T18]: "for personal projects and early experiments; student work, research, side projects, prototypes, and ideas that aren't a business yet." The form asks for a "Project domain".

**Price** [T5]:

- The pricing page gives no number: "Commercial license for production use … Value-based pricing … 100-day free trial … Early-stage startup? Discounted pricing is available … Just building for fun? Get a free hobby license."
- The often-quoted "$6,000/year" comes from an HN commenter (2025-09-18), not from tldraw (S) [T19].
- Steve Ruiz (CEO) wrote in that thread that early-adopter answers clustered around "a number between $5,000 and $10,000" (S) [T19].

**What the code does.** This is `src/lib/license/LicenseManager.ts` in the **published `@tldraw/editor@5.6.0` tarball**; the same logic is on main [T20]:

```ts
if (hostname.endsWith('.localhost')) { return process.env.NODE_ENV !== 'production' }
return ( protocol === 'http:' || (protocol === 'https:' && this.isLoopbackHost(hostname)) || process.env.NODE_ENV !== 'production' )
```

**What this means for Overdeck** (my reading, not legal advice):

- **Technically:**
  - `http://localhost:3011` (any `http:` origin other than `*.localhost`) counts as development, so no key is needed and the editor renders.
  - **`overdeck.localhost` in a production build (`NODE_ENV=production`) counts as production, even over plain `http:`.** The `.localhost` branch returns before the `http:` check. The docs page's "protocol is not HTTPS → development" rule does not hold for `*.localhost`.
  - Any HTTPS remote domain (Overdeck Anywhere, a Traefik domain) also counts as production. Without a valid key covering that host, the editor stops rendering after 5 s.
  - Ordinary keys list allowed hosts. A single key for every self-hoster's domain would need a negotiated `*` (any-domain) enterprise license.
- **Legally:**
  - An Overdeck user running the dashboard for themselves is arguably not "accessible to end users, customers, or the public". But the license defines Production as "where the software is used to provide functionality to end users", and the open-source note says "downstream users will require their own … license".
  - A public OSS project cannot relicense the SDK and must ship `LICENSE.md` verbatim.
- **Practical consequence.** Bundling tldraw puts a source-available, non-OSS dependency into the public dashboard. Each team that uses the feature beyond a plain `http://localhost` setup needs its own key: hobby with the watermark, or commercial. The alternative is Overdeck negotiating a `*` license. A commercial team using Overdeck needs a commercial license.
- **The alternative is Excalidraw.** `@excalidraw/excalidraw` 0.18.1 is MIT, with peer React `^17.0.2 || ^18.2.0 || ^19.0.0`; the repo has 135,639 stars (P, npm/GitHub API). The installed `excalidraw` skill already supports Mermaid conversion and MCP-driven element CRUD, which avoids the problem entirely.

---

## 2. NVIDIA NeMo-Speech.cpp: OS, backends, binaries, licenses

Repo facts [N1]:

- Created 2026-07-15. 254 stars. Pushed 2026-11-13.
- Repo license: Apache-2.0.
- Releases: v0.1.0 (2026-08-19), v0.2.0 (2026-10-02), **v0.3.0 (2026-10-30)**, plus a daily `nightly`.

### 2.1 Prebuilt archives in v0.3.0 (P, GitHub releases API)

| OS / arch | CPU | CUDA | Vulkan | Metal |
|---|---|---|---|---|
| Linux x86_64 | yes | yes (Turing / CC 7.5 and newer) | yes | — |
| Linux aarch64 | yes | cuda12 (Jetson Orin), cuda13 (Jetson Thor, DGX Spark) | yes | — |
| macOS aarch64 (Apple Silicon) | yes | — | — | **yes** |
| macOS x86_64 | yes | — | — | — |
| Windows x86_64 | yes | yes | yes | — |
| Windows aarch64 | — | yes | — | — |

Quotes from `docs/install.md` [N2]:

> The installer downloads a prebuilt release archive for your backend containing the ASR, diarization, translation, and TTS CLI, HTTP API, realtime WebSocket endpoint, browser playground, SDK, and notices. It builds from source when a matching archive is unavailable.

> **For the best performance, build natively from source** … Tagged releases are cut periodically and can trail the `main` branch; for prebuilt binaries of the latest `main`, pass `--channel nightly`.

> Prebuilt Linux archives require glibc 2.31 or newer (Ubuntu 20.04 or equivalent). Prebuilt CPU archives require no GPU toolkit. Linux CUDA archives include the required user-space CUDA libraries but still need a compatible NVIDIA driver.

> The installer selects CUDA when `nvidia-smi` is available, Metal on Apple Silicon, and CPU otherwise.

Windows notes [N2]:

- The default `server` profile includes ASR, diarization, TTS, NMT, HTTP API and playground. "Binary installation is limited to `server`; other selections build from source."
- "Text normalization is not supported on Windows." Linux and macOS archives include ITN and TN.

Source builds, from `docs/build.md` [N3]:

> Presets follow `<backend>-<component>` for the `cpu`, `cuda`, `metal`, and `vulkan` backends … `<backend>-server` | ASR, diarization, speech-LLM transcription, NMT, TTS, HTTP API, realtime WebSocket, and playground.

> Metal builds require macOS on Apple Silicon and the Xcode Command Line Tools. CUDA 12 and 13 are supported; CUDA builds with `patches/` (the default) need CUDA 12.8 or newer.

Windows source builds use Visual Studio 2022 Build Tools (`scripts\windows\build.ps1 -Backend cuda|vulkan|cpu`).

**`nemo-speech serve`.** It "hosts HTTP, realtime WebSocket, and the browser playground" and binds to `127.0.0.1:8080` by default [N1][N5]. Routes:

- `POST /v1/audio/diarizations`
- WebSocket `/v1/audio/transcriptions/realtime`, "live PCM16 transcription"
- `/v1/realtime`, full-duplex VoiceChat

There is no documented per-OS restriction on the server itself, and every archive above is built from the server preset (P) [N2][N5]. Full-duplex VoiceChat needs the `cuda-s2s` build [N3].

**Performance.** The README publishes no Metal or Vulkan numbers. For Nemotron Speech Streaming 0.6B Q8_0 with 160 ms chunks, it gives RTX 4090: 2.3 ms per chunk, 67x real time; "CPU": 27 ms, 6x real time. No CPU model is named [N1].

### 2.2 Licenses (P)

- **Code:** "NVIDIA-authored code is released under the Apache License 2.0 … Third-party components retain their respective terms" (README) [N1].

| Model (HF) | License | HF downloads, last 30 days |
|---|---|---|
| nvidia/nemotron-speech-streaming-en-0.6b | **NVIDIA Open Model License** (`license:other`, `nvidia-open-model-license`) | 89,608 |
| nvidia/nemotron-3.5-asr-streaming-0.6b | **OpenMDW-1.1** | 520,893 |
| nvidia/Nemotron-3-Diarization | **OpenMDW-1.1** | 211,879 |
| nvidia/parakeet-tdt-0.6b-v3 | CC-BY-4.0 | 528,820 |
| nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B | OpenMDW-1.1 | 78,023 |

Source: HF API [N4].

---

## 3. STT popularity (Nov 2026), by metric

**No developer survey ranking STT providers was found.** No vendor-neutral market-share figure exists either. The paid analyst reports (Research and Markets, Mordor, Grand View) give market size only, $2.9–5.6 B for 2026, not vendor shares (S) [POP9].

### 3.1 Cloud

**OpenRouter transcription rankings.** Weekly requests, data through 2026-11-12 [POP1]. This is only OpenRouter's traffic, which skews toward cheap Whisper routing; AssemblyAI, Speechmatics and Soniox are absent or minor there.

| # | Model | Weekly requests | Δ |
|---|---|---|---|
| 1 | Whisper Large V3 Turbo (openai) | 25.9 M | +50% |
| 2 | Whisper Large V3 | 11 M | +11% |
| 3 | MAI-Transcribe 2 (microsoft) | 9.21 M | +16% |
| 4 | Scribe v2 (elevenlabs) | 1.98 M | −9% |
| 5 | GPT-4o Mini Transcribe | 1.02 M | +21% |
| 6 | GPT Transcribe | 901 K | +35% |
| 7 | Qwen3 ASR 1.7B | 783 K | +21% |
| 8 | Parakeet TDT 0.6B v3 | 671 K | +28% |
| 9 | Whisper 1 | 666 K | +12% |
| 10 | Grok STT 1.0 (x-ai) | 654 K | −8% |

Share by author, week of 2026-11-02: OpenAI 70.7%, Microsoft 17.0%, ElevenLabs 2.9%, NVIDIA 2.1%, Mistral 1.7%, Qwen 1.6%, SpaceXAI 1.4%, Deepgram 1.0%, Google 0.6%.

**SDK downloads** (P). npm figures are weekly, 2026-11-06..12 [POP2]. PyPI figures are for the last 30 days, from pypistats [POP3]. These are noisy: CI installs, transitive dependencies, and SDKs that also cover TTS (ElevenLabs) all inflate counts. Even so, it is the only metric measured the same way across vendors.

| Vendor | npm SDK / week | PyPI SDK / 30 d |
|---|---|---|
| Google Cloud Speech | `@google-cloud/speech` 808 K | `google-cloud-speech` 13.8 M |
| ElevenLabs (TTS + STT) | `@elevenlabs/elevenlabs-js` 1.42 M | `elevenlabs` 11.3 M |
| **Deepgram** | `@deepgram/sdk` **1.39 M** | `deepgram-sdk` 3.91 M |
| **AssemblyAI** | `assemblyai` **680 K** | `assemblyai` 4.05 M |
| Azure Speech | `microsoft-cognitiveservices-speech-sdk` 703 K | `azure-cognitiveservices-speech` 2.74 M |
| AWS Transcribe Streaming | `@aws-sdk/client-transcribe-streaming` 575 K | (boto3, not separable) |
| Soniox | `@soniox/speech-to-text-web` 93 K | `soniox` 626 K |
| Speechmatics | `@speechmatics/real-time-client` 56 K | `speechmatics-rt` 302 K (+ `speechmatics-python` 38 K) |
| Gladia | `@gladiaio/sdk` 7.9 K | — |

**Vendor-reported counts** (marketing claims, P that the claim is made):

- **Deepgram homepage:** "650K+ developers building", "5,000+ organizations", "200K+ years of audio processed" (raw HTML grep confirms) [POP4]. This conflicts with January–April 2026 coverage of "200,000+ developers, 1,300–1,400 organizations" (S) [POP5]. Deepgram raised a $130 M Series C at a $1.3 B valuation (2026-01-13, S) and is acquiring Daily/Pipecat (2026-10-29, P) [B7].
- **AssemblyAI** (contact-sales page): "400k+ Developers building", "1B+ Audio files processed" [POP6]. An AssemblyAI marketing blog says "1,500 corporate customers and over a million developers" (S, inconsistent) [POP7].
- **Speechmatics, ElevenLabs Scribe:** no current customer or developer count found.

**Cloud ranking, synthesized.** Weights: request share on OpenRouter, SDK downloads, vendor claims.

1. **OpenAI**: Whisper API, GPT Transcribe. Dominant on OpenRouter.
2. **Google Cloud Speech**: largest PyPI and npm SDK footprint, but much of it is legacy and transitive.
3. **Deepgram**: largest dedicated-STT SDK downloads.
4. **ElevenLabs Scribe**: SDK numbers are inflated by TTS.
5. **AssemblyAI.**
6. **Microsoft**: Azure Speech plus MAI-Transcribe 2, a fast riser (#3 on OpenRouter).
7. AWS Transcribe.
8. Soniox.
9. Speechmatics.

### 3.2 Open / local

**GitHub stars** (P, `gh api`, 2026-11-13) [POP8]:

| Repo | Stars |
|---|---|
| openai/whisper | 112,659 |
| ggml-org/whisper.cpp | 55,165 |
| cjpais/Handy (local dictation app; Parakeet/Whisper/Moonshine) | 38,680 |
| SYSTRAN/faster-whisper | 26,722 |
| mozilla/DeepSpeech (archived) | 26,774 |
| m-bain/whisperX | 25,250 |
| modelscope/FunASR | 21,018 |
| NVIDIA-NeMo/Speech (was NVIDIA/NeMo) | 18,747 |
| k2-fsa/sherpa-onnx | 15,929 |
| alphacep/vosk-api | 15,256 |
| moonshine-ai/moonshine | 11,505 |
| pyannote/pyannote-audio (diarization) | 10,792 |
| snakers4/silero-vad (VAD) | 10,657 |
| KoljaB/RealtimeSTT | 10,245 |
| QwenAudio/SenseVoice | 9,747 |
| argmaxinc/argmax-oss-swift (WhisperKit) | 6,454 |
| collabora/WhisperLive | 4,358 |
| huggingface/distil-whisper | 4,118 |
| QwenLM/Qwen3-ASR | 3,894 |
| kyutai-labs/delayed-streams-modeling | 3,052 |
| NVIDIA/NeMo-Speech.cpp | 254 |

**Hugging Face downloads, last 30 days** (P, HF API `downloads`; all-time in parentheses) [POP10].

Caveats:

- `argmaxinc/whisperkit-coreml` (63.9 M) and the `jonatasgrosman/wav2vec2-*` rows (up to 16.3 M) are pipeline- and CI-inflated.
- `pyannote/*` are diarization models, not ASR.

| Model | 30-day | (all-time) |
|---|---|---|
| openai/whisper-base | 5.18 M | (56.0 M) |
| openai/whisper-large-v3-turbo | 4.88 M | (128 M) |
| openai/whisper-small | 4.45 M | (142 M) |
| openai/whisper-large-v3 | 3.45 M | (154 M) |
| Systran/faster-whisper-small / -large-v3 | 5.97 M / 1.67 M | |
| mlx-community/parakeet-tdt-0.6b-v3 | 2.65 M | (14.6 M) |
| handy-computer/parakeet-unified-en-0.6b-gguf | 2.35 M | |
| handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf | 1.83 M | |
| Qwen/Qwen3-ASR-1.7B | 1.62 M | (18.3 M) |
| mistralai/Voxtral-Mini-4B-Realtime-2602 | 1.51 M | (14.9 M) |
| distil-whisper/distil-large-v3 | 754 K | (21.6 M) |
| microsoft/VibeVoice-ASR | 716 K | |
| nvidia/parakeet-tdt-0.6b-v3 | 529 K | (3.93 M) |
| nvidia/nemotron-3.5-asr-streaming-0.6b | 521 K | (4.31 M) |
| Qwen/Qwen3-ASR-0.6B | 489 K | |
| nvidia/Nemotron-3-Diarization | 212 K | |
| nvidia/parakeet-tdt-0.6b-v2 | 149 K | (11.9 M) |
| CohereLabs/cohere-transcribe-03-2026 | 106 K | |
| nvidia/nemotron-speech-streaming-en-0.6b | 89.6 K | (1.02 M) |
| moonshine-ai/moonshine-streaming-tiny / small / medium | 52 K / 48 K / 48 K | |
| distil-whisper/distil-large-v3.5 | 12.8 K | |
| pyannote/speaker-diarization-3.1 / community-1 | 6.64 M / 5.06 M | (diarization) |

**PyPI, last 30 days** [POP3]:

- faster-whisper 18.7 M
- openai-whisper 6.35 M
- sherpa-onnx 3.88 M
- pyannote-audio 1.37 M
- vosk 1.20 M
- pywhispercpp 903 K
- whisperx 654 K
- mlx-whisper 598 K
- nemo-toolkit 445 K
- moonshine-voice 85 K

npm, weekly: sherpa-onnx-node 1.15 M; `@moonshine-ai/moonshine-js` 7.7 K.

**Open/local ranking, synthesized:**

1. **Whisper family**: openai/whisper, faster-whisper, whisper.cpp, WhisperKit, distil-whisper. First on every metric.
2. **NVIDIA Parakeet / Nemotron**: fastest-growing; heavy GGUF, MLX and Handy redistribution.
3. **sherpa-onnx** (runtime).
4. **Qwen3-ASR.**
5. **Voxtral Mini Realtime.**
6. **Vosk** (legacy).
7. **Moonshine**: high stars, low model downloads.

---

## 4. STT leaderboards a human can browse

| Board | URL | Measures | Streaming / batch | Run by | Independence |
|---|---|---|---|---|---|
| **HF Open ASR Leaderboard** v1.16.0 (2026-11-13) | huggingface.co/spaces/hf-audio/open_asr_leaderboard | Avg WER over AMI, Earnings22, Gigaspeech, SPGI, URGENT24, Voice Arena Monsoon, VoxPopuli, plus 2 private sets; RTFx; separate multilingual, long-form (Earnings21/22, CORAAL) and scripted-vs-conversational tabs | **Offline decoding only** | Hugging Face's `hf-audio` Space | Platform-hosted; lists open and closed API models. No latency, price or diarization. Governance not checked today. |
| **Artificial Analysis, STT** (batch) | artificialanalysis.ai/speech-to-text | AA-WER v2 (AgentTalk 50%, VoxPopuli 25%, Earnings22 25%; ~8 h), speed factor (7-day median), $/1000 min | Batch | Artificial Analysis | Independent benchmarking firm; vendors can be paying customers (U) |
| **Artificial Analysis, STT streaming** | artificialanalysis.ai/speech-to-text/streaming | Streaming AA-WER (final and first-partial), **time to final transcript** from SileroVAD end-of-speech (forced endpoint where supported), time to first partial, price; 49 configs | Streaming | same | same |
| **Voice Arena** STT | voicearena.com (US English) and /stt-leaderboard/{overall,arabic,bangla,vietnamese…} | **Semantic WER** (open-source scorer `va-semantic-wer`), normalized WER, CER; private/public split with 95% CIs and rank ranges; Monsoon conversational test set | Both, labeled | Voice Arena (SF; co-founder/CEO Shobhit Banga) | Funding and vendor ties undisclosed; Diamond Sponsor of Interspeech 2026 |
| **Voice Arena Diarization-Bench** | voicearena.com/diarization-bench | **DER** at 0/100/250 ms collars, JER, speaker-count accuracy, miss / false-alarm / confusion; separate Diarization+ASR **cpWER** track; 139 sessions, 22 h, 2–8 speakers | Real-time/offline filter exists, but rows are not labeled in text | same | same |
| **Coval STT benchmark** | benchmarks.coval.ai/stt | WER and **TTFS** p50/p95 (from a shared VAD marker; provider endpointing not used); 1/7/30-day windows; 30+ models; Pipecat turns plus 6 public sets | Streaming | Coval (voice-agent testing vendor; "doesn't sell speech-to-text") | Method open (Apache-2.0); funding and vendor ties undisclosed |
| **Pipecat STT benchmark** | github.com/pipecat-ai/stt-benchmark (current); pipecat.ai/benchmarks/speech-to-text (older, Aug 2026 scoring) | Pooled **semantic WER** (judged by Claude Sonnet 5.5 since Sept 2026), TTFS median/P95/P99, Pareto frontier, bootstrap CIs; 1,000 clips; 25 rows | Streaming through an identical Pipecat pipeline | Daily/Pipecat, **being acquired by Deepgram** (announced 2026-10-29) | Was neutral; a competitor is buying it (says it stays "vendor neutral"). NVIDIA rows are self-hosted (no network RTT) and still scored by the old judge. |
| **Cekura STT** | benchmarks.cekura.ai/stt | WER, TTFT/TTFS P50/P90/P95, $/hr; Pipecat 1,000 clips plus 300 licensed phone turns (Ocular); ~20 models | Streaming | Cekura (voice-agent QA vendor) | Vendor-run; date inconsistent (says 2026-09-16, cites Oct prices) |
| **Picovoice speech-to-text-benchmark** | github.com/Picovoice/speech-to-text-benchmark; picovoice.ai/docs/benchmark/ | WER (LibriSpeech, TED-LIUM, CommonVoice; 6 langs), punctuation error rate, **word emission latency**, **core-hours** (CPU), model size | Batch and streaming, **on-device focus** | Picovoice (sells Cheetah/Leopard) | Vendor-run, open code, 699 stars, updated 2026-11-06 |
| AssemblyAI benchmarks | assemblyai.com/benchmarks | Streaming WER (own voice-agent corpus, 3 noise conditions), entity, code-switching, medical, **real-time DER**; batch WER/DER/cpWER; 26 RT competitors | Both | AssemblyAI | Vendor; reports losses as well as wins |
| Deepgram benchmarks | deepgram.com/benchmarks | Batch/streaming WER on ~30 h per language of private production audio, 20 languages; TTS | Both | Deepgram | Vendor; private data; dated April 2026 |
| Soniox benchmarks | soniox.com/benchmarks | Republishes Pipecat semantic WER and TTFS | Streaming | Soniox (data from Pipecat) | Vendor framing of third-party data |
| Speechmatics | No benchmark page (`/benchmarks` returns 404); has "how we compare" pages only | | | | |

Sources: [B1]–[B12].

### 4.1 Diarization: Voice Arena Diarization-Bench (P) [B5]

| # | System | Type | DER 0 ms | JER |
|---|---|---|---|---|
| 1 | **NVIDIA Nemotron 3 Diarization** | open | **14.72** | 25.53 |
| 2 | BUT FIT DiariZen WavLM Large s80 MD v2 | open | 19.34 | 30.94 |
| 3 | pyannoteAI Precision-3 | API | 20.56 | 31.69 |
| 4 | pyannoteAI Precision-2 | API | 23.41 | 36.01 |
| 5 | NVIDIA Streaming Sortformer 4spk v2 | open | 24.61 | 37.44 |
| 6 | pyannote community-1 | open | 30.61 | 43.87 |

The launch page cites 12 systems; the text view showed these 6. A news report has Voxtral Mini Transcribe 3 at 40.4% (S). No other cross-vendor real-time DER board exists. AssemblyAI's real-time DER table (Muse 14.5, AssemblyAI 16.0, Reson8 16.7, Azure 20.4, Speechmatics 22.2) remains vendor-run [B10].

### 4.2 Artificial Analysis streaming board, extracted (P) [B3]

Columns: AA-WER = streaming AA-WER, final transcript. Final = time to final transcript. 1st = time to first partial. $/hr = $/1000 min × 0.06.

| Model | AA-WER | Final | 1st | $/hr |
|---|---|---|---|---|
| MAI-Transcribe-2-Streaming | **2.51%** | 128 ms | 122 ms | 0.54 |
| Zoom Scribe V2.1 Pro Live | 2.68% | 913 ms | 697 ms | 0.40 |
| Grok Voice Transcribe 2.0 (Streaming) | 2.73% | 490 ms | 489 ms | 0.20 |
| ElevenLabs Scribe v3 Live | 2.86% | **81 ms** | 72 ms | 0.22 |
| Meta Muse Voice Transcribe | 3.06% | 163 ms | 127 ms | 0.18 |
| Cartesia Ink Preview (ext. endpoints) | 3.11% | 105 ms | 89 ms | 0.24 |
| Cartesia Ink-2 (ext. endpoints) | 3.17% | 136 ms | 117 ms | 0.61 |
| Reson8 Resonant-1 Realtime | 3.22% | 278 ms | 244 ms | 1.34 |
| Voxtral Mini Transcribe Realtime 3 (960 ms) | 3.34% | 1,119 ms | 230 ms | 0.48 |
| Sarvam Saaras v4 Realtime | 3.54% | 422 ms | 206 ms | 0.31 |
| AssemblyAI U3.6 Pro RT, Min Latency | 3.57% | 192 ms | 188 ms | 0.45 |
| ElevenLabs Scribe v2 Realtime | 3.59% | 141 ms | 134 ms | 0.39 |
| Qwen3 ASR Flash Realtime | 3.76% | 403 ms | 341 ms | 0.32 |
| AssemblyAI U3.6 Pro RT, Max Accuracy | 3.85% | 197 ms | 193 ms | 0.45 |
| OpenAI GPT Live Transcribe | 3.92% | 812 ms | 256 ms | 1.02 |
| Gemini 3.5 Transcribe Live | 4.00% | 395 ms | 250 ms | 0.54 |
| Inworld Realtime STT 1 | 4.18% | 71 ms | 68 ms | 0.15 |
| Speechmatics Agent STT Linden 1 | 4.42% | 157 ms | 128 ms | 0.30 |
| Soniox v5 / v6 Real-Time | 4.50% / 4.57% | **54 / 80 ms** | 47 / 61 ms | 0.12 |
| Chirp 3 Streaming | 4.80% | 1,276 ms | 1,200 ms | 0.96 |
| Amazon Transcribe Streaming | 5.10% | 488 ms | 230 ms | 0.60 |
| Azure STT Real-time | 5.25% | 625 ms | 215 ms | 1.00 |
| NVIDIA "Nemotron 3 ASR" 1120 ms / 560 ms / 160 ms / 80 ms (self-hosted, open) | 5.36 / 5.96 / 7.61 / 8.38% | 418 / 252 / 98 / 73 ms | | 0 |
| Deepgram Flux | 5.91% | **42 ms** | 40 ms | 0.46 |
| Deepgram Nova-3 Realtime | 6.59% | 66 ms | 64 ms | 0.46 |
| Gladia Solaria 1 Realtime | 7.82% | 1,523 ms | 431 ms | 0.76 |
| Speechmatics Realtime Enhanced | 8.05% | 317 ms | 201 ms | 0.80 |
| AssemblyAI Universal Streaming English | 8.18% | **34 ms** | 32 ms | 0.15 |
| Rev AI Streaming | 10.14% | 697 ms | 178 ms | 0.20 |

**AA's NVIDIA rows carry conflicting identifiers:**

- Display name: "Nemotron 3 ASR".
- Model name: "NVIDIA-Nemotron-3.5-ASR-Streaming-Multilingual-0.6b".
- API id: `cache-aware-parakeet-rnnt-en-US-asr-streaming-1120ms`.

Don't pin these numbers to one checkpoint (U).

### 4.3 AA batch board, top and open-weights rows (P) [B2]

Top rows by AA-WER:

| Model | AA-WER | Speed factor | $/1000 min |
|---|---|---|---|
| Fun-Realtime-ASR-preview | 1.73 | 20.7 | 2.82 |
| ElevenLabs Scribe v3 (2026-11-10) | 1.95 | 74.3 | 3.33 |
| MAI-Transcribe-2 | 2.04 | 313 | 1.67 |
| Zoom Scribe V2.1 Pro | 2.06 | | |
| Voxtral Small Transcribe 3 | 2.09 | | |
| Scribe v2 | 2.18 | | |
| Voxtral Mini Transcribe 3 | 2.22 | | |
| Grok Voice Transcribe 2.0 | 2.29 | | |

Open-weights rows (AA-WER):

| Model | AA-WER | Speed factor |
|---|---|---|
| Nemotron 3.5 Transcribe (DeepInfra) | 3.42 | |
| Whisper Large v3 (fal) | 4.07 | |
| Canary Qwen 2.5B | 4.27 | |
| Whisper L-v3 (Together) | 4.53 | 243 |
| Parakeet TDT 0.6B v3 (Together) | 4.55 | **681** |
| Whisper L-v3 Turbo (Groq) | 4.62 | 351 |
| Parakeet TDT 0.6B v2 | 6.43 | |

### 4.4 Cross-board streaming winners (do not mix the columns)

**Pipecat** [B6]. The table is the current GitHub README, pushed 2026-11-06 (P): pooled semantic WER / median TTFS, Sonnet 5.5 judge. The pipecat.ai page still shows the older Aug 2026 scoring (for example Muse 0.83%, U3.6 0.96%), so do not mix the two. The repo says differences under ~0.25 pp among the top services are within the 95% CI.

| Model | Pooled WER | Median TTFS |
|---|---|---|
| Soniox stt-rt-v6 | **0.71%** | 266 ms |
| Meta Muse | 0.73% | 392 ms (P95 1,292) |
| xAI Grok STT 2.0 | 0.79% | 1,322 ms |
| AssemblyAI U3.6 Pro | 0.80% | 307 ms |
| AssemblyAI U3.5 Pro | 0.95% | 282 ms |
| Speechmatics Linden-1 | 0.96% | 369 ms |
| Azure | 1.01% | 1,016 ms |
| Cartesia Ink-2 | 1.02% | 299 ms |
| Soniox v5 | 1.09% | 260 ms |
| Deepgram Nova-3 | 1.37% | 247 ms |
| Gemini 3.5 Transcribe Live | 1.97% | 458 ms |
| ElevenLabs Scribe v2 RT | 3.13% | 281 ms |
| NVIDIA "Nemotron 3.0 ASR (en)", self-hosted | 1.95%† | **221 ms** |
| NVIDIA "Nemotron 3.5 ASR (multilingual)" | 4.58%† | 236 ms |

† Old judge, "about 15% higher on average". Scribe v3 Live is not in the table.

Which checkpoint is "Nemotron 3.0 ASR (en)"? The repo's `services.py` has an `nvidia` service (`nemotron-asr-streaming`, NVIDIA API) and an `nvidia_sagemaker` service (`cache-aware-parakeet-rnnt-en-US-asr-streaming-sortformer`). It is the English cache-aware streaming RNNT served by NVIDIA, the same architecture as `nemotron-speech-streaming-en-0.6b`, but the exact checkpoint and runtime are not confirmed. It was not run on NeMo-Speech.cpp (U).

Soniox's benchmark page republishes the 0.71% [B11].

**Coval** (30 days to 2026-10-28, WER / p50 TTFS) [B8]:

- AssemblyAI U3.6 Pro: 2.2% / 106 ms
- Qwen3 ASR Fast (Nari Labs): 2.6% / 45 ms
- Inworld STT 1: 4.3% / 66 ms
- Soniox RT v5: 4.8% / **37 ms**
- Deepgram Flux: 5.7% / 99 ms

**Voice Arena** (semantic WER, private set, streaming rows) [B4]:

- AssemblyAI U3.6 Pro RT: 2.50% (rank 2–11)
- Fish Audio Transcribe Stream 1: 2.75%
- Scribe v3 Live: 2.89%
- Amazon Transcribe Streaming: 3.18%
- Grok STT 2.0 Streaming: 3.28%
- Speechmatics Enhanced Streaming: 3.89%
- Deepgram Nova-3: 4.81%
- Nemotron 3.5 Streaming (open): 5.74%

**Cekura:** Scribe v3 Live 1.89% overall WER, 57 ms TTFS P50; Reson8 Rumble-2 2.05%, 18 ms [B12].

**AssemblyAI** (vendor): streaming WER U3.6 5.19%, Soniox 6.83%, Muse 7.48% [B10].

**Picovoice** (vendor; LibriSpeech, TED-LIUM, CommonVoice) [B9]:

| Engine | Streaming WER | Word emission latency | Core-hours per 100 h audio |
|---|---|---|---|
| Picovoice Cheetah | 7.7% | 560 ms | 8.7 |
| Nemotron 3.5 ASR Streaming | 7.8% | 450 ms | 243 |
| Moonshine Medium | 10.6% | 640 ms | 336 |
| Vosk Large | 11.5% | 2,000 ms | 33.6 |
| whisper.cpp streaming base | 19.8% | 1,240 ms | 167 |
| Amazon Transcribe Streaming | 5.3% | 290 ms | (cloud) |
| Azure real-time | 5.9% | 520 ms | (cloud) |
| Google streaming | 9.0% | 830 ms | (cloud) |

---

## 5. If speaker labels are NOT required: top choices

Rule used: name per-board results, then pick the engines that sit in the top tier on three or more boards.

### (a) Cloud streaming accuracy

| Board | Leader |
|---|---|
| Artificial Analysis | MAI-Transcribe-2-Streaming 2.51% (then Zoom 2.68, Grok 2.73, Scribe v3 Live 2.86, Muse 3.06) |
| Pipecat (repo, Nov) | Soniox v6 0.71%, Muse 0.73%, Grok 0.79%, U3.6 Pro 0.80% (all within CI of each other) |
| Coval | AssemblyAI U3.6 Pro 2.2% |
| Voice Arena | AssemblyAI U3.6 Pro RT 2.50% |
| Cekura | Scribe v3 Live 1.89% |
| AssemblyAI (vendor) | U3.6 Pro 5.19% |

Picks (by the three-board rule):

1. **AssemblyAI Universal-3.6 Pro Realtime.**
   - Top tier on Coval (#1), Voice Arena (#1 streaming, #2 overall), Pipecat (within CI of #1) and AssemblyAI's own board.
   - Only on AA is it mid-pack (3.57–3.85%).
   - $0.45/hr.
2. **Meta Muse Voice Transcribe.**
   - Top tier on Pipecat (#2, within CI), AA (#5) and AssemblyAI's board (#4).
   - Voice Arena rank 18 (3.07%, tested as batch).
   - $0.18/hr. Long P95 tail (1.3 s) on Pipecat.
3. **ElevenLabs Scribe v3 Live** (launched 2026-11-10).
   - #4 on AA, #1 on Cekura.
   - Voice Arena 2.89% (rank 13–19, #3 among streaming rows).
   - Not yet on Pipecat or Coval.
   - $0.22/hr. Fewer boards than the two above, so it is still provisional.
4. **MAI-Transcribe-2-Streaming.**
   - #1 on AA (2.51%, 128 ms final).
   - Not seen in the rows I read on the other boards.
   - Preview, $0.54/hr, no diarization.

Also strong on one or two boards: Soniox v6 (Pipecat #1, but AA 4.57%), Grok STT 2.0 (AA #3, Pipecat 0.79% but 1.3 s TTFS).

### (b) Cloud lowest latency (with acceptable WER)

- **AA, time to final:** AssemblyAI Universal Streaming EN 34 ms (but 8.18% WER), Deepgram Flux 42 ms (5.91%), Soniox v5 54 ms (4.50%), Deepgram Nova-3 66 ms, Inworld 71 ms (4.18%), **Scribe v3 Live 81 ms at 2.86%**, Cartesia Ink Preview 105 ms (3.11%), MAI-2-Streaming 128 ms (2.51%).
- **Coval, p50 TTFS:** Soniox RT v5 37 ms, Qwen3 ASR Fast 45 ms, Inworld 66 ms, Flux 99 ms, U3.6 Pro 106 ms.
- **Cekura:** Reson8 Rumble-2 18 ms, Scribe v3 Live 57 ms.

Picks:

- **Soniox stt-rt-v5/v6**: fastest tier on AA (54–80 ms) and Coval (37 ms), 260–266 ms on Pipecat; $0.12/hr. WER is best on Pipecat but mid-pack on AA.
- **ElevenLabs Scribe v3 Live**: the best latency × accuracy point on AA.
- **Deepgram Flux** when built-in end-of-turn matters more than WER.

### (c) Local GPU (RTX 3090)

**Streaming:**

- **Nemotron Speech Streaming EN 0.6B on NeMo-Speech.cpp** (CUDA). Evidence:
  - Open ASR 7.47 (offline decode).
  - Pipecat: "Nemotron 3.0 ASR (en)", self-hosted, is the fastest row (221 ms median TTFS) at 1.95% WER. That figure was scored by the old judge (~15% higher), so it is roughly comparable to Deepgram Nova-3's 1.37%. The row excludes network round-trip, and the exact checkpoint is unconfirmed (see §4.4).
  - 2.3 ms per 160 ms chunk on an RTX 4090.
  - NVIDIA Open Model License.
- Second choice: **Voxtral Mini 4B Realtime 2602** (Apache-2.0, vLLM). Open ASR 9.72.
- The multilingual **Nemotron 3.5 ASR Streaming** scores worse in English: Open ASR 11.09, Pipecat 4.58%, Voice Arena 5.74%.

**Batch or re-transcribe** (for a cleaner transcript after the meeting):

| Model | Open ASR | Voice Arena | License |
|---|---|---|---|
| Qwen3-ASR-1.7B | 6.15 | 2.58% | Apache-2.0 |
| Cohere Transcribe 03-2026 | 6.72 | 2.56% | Apache-2.0 |
| Nemotron 3.5 Transcribe 30B-A4B | 6.13 (AA 3.42) | 2.61% | OpenMDW; needs quantized GGUF to fit 24 GB (U) |
| Parakeet TDT 0.6B v2 | 6.93 (RTFx 6,148) | 3.01% | CC-BY-4.0 |

Parakeet TDT 0.6B v2 is the pick when throughput matters.

### (d) Local CPU

**Streaming:**

- **Nemotron Speech Streaming / 3.5 ASR Streaming on NeMo-Speech.cpp CPU.**
  - The README says 6x real time at 27 ms per 160 ms chunk, Q8, hardware unnamed.
  - Picovoice: Nemotron 3.5 Streaming 7.8% WER, 450 ms emission, ~2.4 cores continuous (243 core-hours per 100 h). It beats Moonshine Medium (10.6%, 640 ms, 3.4 cores) on all three.
- **Moonshine streaming** remains the smallest-footprint MIT option: tiny 49 MB, small 158 MB, vs Nemotron's 2.2 GB.

**Batch:**

- **Parakeet TDT 0.6B v2/v3 int8 through sherpa-onnx(-node)**: Open ASR 6.93 / 7.04, OpenRouter #8 by usage. No published CPU RTF found today (U).
- IBM Granite Speech 5.0 470m turbo-CTC: Open ASR 7.41, RTFx 21,434 (GPU-measured). The `-nc` variant is non-commercial.

---

## Sources

**tldraw**
- [T1] npm registry: https://registry.npmjs.org/tldraw (and `/@tldraw/{sync,sync-core,mermaid,driver,ai,editor}`); downloads https://api.npmjs.org/downloads/point/last-week/tldraw
- [T2] https://tldraw.dev/community/license (raw HTML)
- [T3] https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- [T4] https://tldraw.dev/faq (raw HTML)
- [T5] https://tldraw.dev/pricing (raw HTML)
- [T6] https://tldraw.dev/starter-kits/agent ; https://tldraw.dev/docs/ai
- [T7] https://github.com/tldraw/tldraw/tree/main/apps/mcp-app (README, LICENSE.md)
- [T8] https://tldraw.dev/blog/tldraw-mcp-app ; endpoint per https://mcpservers.org/remote-mcp-servers/tldraw (S)
- [T9] https://tldraw.dev/blog/tldraw-sdk-5-0 ; https://tldraw.dev/blog/turning-mermaid-code-into-shapes
- [T10] https://tldraw.dev/docs/driver
- [T11] https://tldraw.dev/blog/tldraw-offline
- [T12] https://github.com/tldraw/tldraw/tree/main/templates/agent (LICENSE.md, package.json)
- [T13] https://www.sean-weldon.com/blog/2026-09-11-the-spatial-harness-bringing-agents-to-the-canvas-max-drake-tldraw ; https://gitnation.com/contents/agents-on-the-canvas-with-tldraw (S)
- [T14] https://tldraw.dev/docs/sync
- [T15] https://tldraw.dev/docs/mermaid
- [T16] https://github.com/OrionReed/tldraw-graph-layout (S)
- [T17] https://tldraw.dev/sdk-features/license-key (raw HTML)
- [T18] https://tldraw.dev/get-a-license/hobby (raw HTML)
- [T19] https://news.ycombinator.com/item?id=45294916 ; https://biggo.com/news/202509190115_tldraw_SDK_4.0_Licensing_Debate (S)
- [T20] https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/license/LicenseManager.ts

**NeMo-Speech.cpp**
- [N1] https://github.com/NVIDIA/NeMo-Speech.cpp (README; `gh api repos/NVIDIA/NeMo-Speech.cpp` and `/releases`)
- [N2] https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/install.md
- [N3] https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/build.md
- [N4] HF API: https://huggingface.co/api/models/nvidia/nemotron-speech-streaming-en-0.6b, …/nvidia/nemotron-3.5-asr-streaming-0.6b, …/nvidia/Nemotron-3-Diarization, …/nvidia/parakeet-tdt-0.6b-v3, …/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B
- [N5] https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md

**Popularity**
- [POP1] https://openrouter.ai/rankings/transcription
- [POP2] https://api.npmjs.org/downloads/point/last-week/<pkg>
- [POP3] https://pypistats.org/api/packages/<pkg>/recent
- [POP4] https://deepgram.com/ (raw HTML)
- [POP5] https://sacra.com/c/deepgram/ ; https://getlatka.com/companies/deepgram (S)
- [POP6] https://www.assemblyai.com/contact/sales
- [POP7] AssemblyAI blog via search (S): https://www.assemblyai.com/blog/conversation-intelligence-software
- [POP8] GitHub API (`gh api repos/<owner>/<repo>`)
- [POP9] https://www.researchandmarkets.com/reports/5951805/speech-to-text-api-market-report ; https://www.grandviewresearch.com/industry-analysis/speech-to-text-api-market-report (S)
- [POP10] HF API: https://huggingface.co/api/models?pipeline_tag=automatic-speech-recognition&sort=downloads&expand[]=downloads&expand[]=downloadsAllTime

**Benchmarks**
- [B1] https://huggingface.co/spaces/hf-audio/open_asr_leaderboard (data: https://hf-audio-open-asr-leaderboard.hf.space/config)
- [B2] https://artificialanalysis.ai/speech-to-text (embedded JSON)
- [B3] https://artificialanalysis.ai/speech-to-text/streaming (embedded JSON)
- [B4] https://voicearena.com/stt-leaderboard/us-english ; https://voicearena.com/
- [B5] https://voicearena.com/diarization-bench ; https://voicearena.com/diarization-bench-v1-launch ; https://huggingface.co/blog/nvidia/nemotron-diarization
- [B6] https://www.pipecat.ai/benchmarks/speech-to-text ; https://github.com/pipecat-ai/stt-benchmark
- [B7] https://deepgram.com/blog/daily-pipecat-deepgram ; https://www.daily.co/blog/deepgram-is-acquiring-daily-and-establishing-an-independent-pipecat-foundation/
- [B8] https://coval.ai/blog/best-speech-to-text-providers-in-2026-independent-benchmarks-and-how-to-choose ; https://benchmarks.coval.ai/stt
- [B9] https://github.com/Picovoice/speech-to-text-benchmark ; https://picovoice.ai/docs/benchmark/real-time-transcription/
- [B10] https://www.assemblyai.com/benchmarks
- [B11] https://soniox.com/benchmarks ; https://www.deepgram.com/benchmarks
- [B12] https://benchmarks.cekura.ai/stt
