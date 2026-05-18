---
name: pan-tts
description: Built-in dashboard text-to-speech playback plus optional external sidecar support through Qwen3-TTS (or any local TTS engine). The dashboard speaks activity.tts events directly when tts.enabled=true; the SSE sidecar remains optional for external TTS on another machine. Also exposes an ad-hoc speak helper (scripts/say.sh) so agents can announce one-off messages on demand.
triggers:
  - pan tts
  - panopticon tts
  - text to speech
  - read activity log
  - speak this
  - say out loud
  - announce
allowed-tools:
  - Bash
  - Read
  - Write
---

# pan-tts — Panopticon Activity TTS

**Status: built into the dashboard when `tts.enabled=true`; external sidecar optional.**

## What It Is

Panopticon has built-in dashboard TTS playback for `activity.tts` events when `tts.enabled=true` in `~/.panopticon/config.yaml`. The dashboard server resolves the configured voice and POSTs directly to the local Qwen3-TTS daemon, so no external subscriber is needed for the normal local-dashboard path.

`pan-tts` remains an **optional** external sidecar for users who want SSE-based TTS on a different machine or want to consume Panopticon's public event stream independently.

The TTS pipeline has three independent components:

1. **Dashboard playback service** — subscribes to internal `activity.tts` events, resolves `tts.voice` / `tts.statusVoice` / `tts.voiceMap`, and forwards utterances to the daemon when dashboard TTS is enabled.
2. **Qwen3-TTS HTTP daemon** (`skills/pan-tts/scripts/tts_daemon.py`) — keeps the 1.7B model resident in VRAM, synthesizes speech on demand via `POST /speak`, and plays audio through the default PipeWire sink. This is the component that actually drives the speaker.
3. **Optional SSE subscriber** (`~/Projects/pan-tts/`) — connects to Panopticon's `/events/stream`, formats condensed utterances, and forwards them to the daemon for external playback.

## Architecture

```
pan dashboard                  qwen-tts daemon            audio out
────────────────────────       ─────────────────          ─────────
activity.tts ──▶ resolve voice ──▶ POST /speak ──▶         PipeWire
                 mute/filter      synthesize (GPU)
                 priority voice   persistent pw-play stream

Optional external path:

/events/stream ──SSE──▶ pan-tts subscriber ──▶ POST /speak ──▶ PipeWire
```

### Why keep the sidecar?

- The dashboard path is the default local playback path when `tts.enabled=true`.
- The GPU daemon is expensive to start (model load ~10s) and must stay resident.
- The optional subscriber is cheap to restart and can run on another machine without touching the dashboard server.
- The `/speak` contract is simple HTTP; anything that can POST JSON can use the daemon.

## Qwen3-TTS HTTP Daemon

**Source:** `skills/pan-tts/scripts/tts_daemon.py`

The daemon loads `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` on `cuda:0` at startup and exposes three endpoints:

- `POST /speak` — queue a text utterance for synthesis and playback
- `POST /extract-embedding` — generate a VoiceDesign audio clip and extract a 2048-dim speaker embedding for voice cloning
- `GET /health` — queue depth and model status

### Running the daemon

```bash
pan install                # creates packages/qwen-tts-linux-x64/.venv on Linux/CUDA
pan install --skip-tts-daemon
pan tts start
pan tts status
pan tts stop
pan tts restart
pan tts install-systemd
```

`pan tts start` uses `tts.daemonHost` and `tts.daemonPort` from `~/.panopticon/config.yaml`, tracks the PID at `~/.panopticon/pids/qwen-tts.pid`, and waits for `/health` before returning. Set `tts.daemon.autoStart: true` to have `pan up` start the daemon automatically; the default is off because the model cold-start and VRAM footprint are expensive.

The daemon auto-detects the default PipeWire sink and uses a **persistent `pw-play` stream** to avoid audio truncation caused by sink suspend/resume (see *PipeWire Suspend* below).

### PipeWire Suspend

PipeWire suspends idle audio sinks by default. When a sink is suspended, the first ~50–500ms of audio can be dropped while the DAC resumes. The daemon handles this in `play_audio()`:

- A persistent `pw-play` subprocess is kept open for up to 10 seconds after the last utterance, keeping the sink **RUNNING** between consecutive announcements.
- On cold starts (sink is **SUSPENDED**), 600ms of silence is prepended to cover the resume latency.
- On warm playback (sink already **RUNNING**), only 50ms of safety silence is added.

This ensures short utterances (e.g. "PAN-1024 ready for merge") are never truncated, while the sink returns to **SUSPENDED** within a reasonable timeout once the queue is drained.

## SSE Subscriber

**Source:** `~/Projects/pan-tts/src/pan_tts/`

The subscriber is a small Python project that connects to Panopticon's SSE feed and speaks activity entries.

### Configuration

`~/.pan-tts/config.yaml`:

```yaml
endpoint: http://127.0.0.1:3000/events/stream
token: ${PANOPTICON_EVENTS_TOKEN}   # optional, only if pan has the token set

filters:
  types: [activity.tts]
  sources: [merge-agent, cloister, review-specialist, test-specialist]
  # issueId: PAN-537  # uncomment to focus on one issue

tts:
  engine: qwen3
  voice: default            # voice id from stream-voices VoiceDesign
  max_chars: 140            # truncate utterances longer than this
  rate: 1.1

queue:
  max_depth: 8            # subscriber-side queue; drops low-priority info events when full
  drop_info_when_full: true
```

Secrets (if any) go in `~/.panopticon.env` alongside the rest of the pan environment — do not duplicate them here.

### Running the subscriber

```bash
# one-shot foreground run (smoke test)
cd ~/Projects/pan-tts
uv run pan-tts

# systemd user unit for permanent install
systemctl --user enable --now pan-tts.service
```

A `pan-tts.service` unit template lives at `~/Projects/pan-tts/systemd/pan-tts.service` — `User=` and `WorkingDirectory=` are pre-filled for this machine.

## Ad-Hoc Speak and CLI Smoke Test

For Panopticon's configured system voice, use the built-in CLI smoke test:

```bash
pan tts test
pan tts test "Build is green, ready for review."
pan tts voices list
pan tts voices show "Vivian Voice"
pan tts voices play "Vivian Voice"
pan tts voices set-default "Vivian Voice"
pan tts voices map reviewStatus.passed "Vivian Voice"
```

`pan tts test` reads `tts.voice` from `~/.panopticon/config.yaml`, resolves it in `~/.panopticon/tts-voices.json`, and POSTs directly to the local Qwen3-TTS daemon at `http://127.0.0.1:8787/speak` (or the configured `tts.daemonHost`/`tts.daemonPort`). If no system voice is configured, set one with `pan tts voices set-default <name>` before running the smoke test.

The skill also bundles `scripts/say.sh` for one-off utterances that bypass Panopticon voice settings:

```bash
./scripts/say.sh "Build is green, ready for review."
./scripts/say.sh "Pan 672 merged to main."
```

The script POSTs to the local Qwen3-TTS daemon at `http://127.0.0.1:8787/speak` (override via `QWEN_TTS_ENDPOINT`). It waits for the daemon to acknowledge the request (up to 5 s); audio then plays asynchronously in the daemon's worker thread. Keep utterances short (under ~200 characters); the daemon's queue caps at 6.

Use ad-hoc speak sparingly — the built-in dashboard playback service or optional SSE sidecar already speaks activity TTS events. Ad-hoc speak is for:
- Announcements that don't warrant a dashboard activity entry (local test runs, meta-commentary)
- Pulling the user's attention during long-running work
- Testing the audio path after a restart

## Verifying It

1. Install the daemon venv: `pan install` on Linux/CUDA, or skip the heavy CUDA install with `pan install --skip-tts-daemon`.
2. Start the daemon: `pan tts start`.
3. Set `tts.enabled: true` and a default voice in `~/.panopticon/config.yaml`.
4. `pan up` — start the dashboard; if `tts.daemon.autoStart: true`, this also starts the daemon.
5. In another terminal: `pan start PAN-XXX` and listen. You should hear dashboard-emitted `activity.tts` events.
6. Optional external sidecar path: start `pan-tts` and watch `journalctl --user -u pan-tts -f`.

If nothing speaks:

- Run `pan tts status` and check the dashboard TTS badge / `GET /api/tts/health` to confirm the daemon is reachable.
- Check that `tts.voice` points at an existing voice in `~/.panopticon/tts-voices.json`.
- For the optional sidecar path, check `curl -N http://127.0.0.1:3000/events/stream?types=activity.tts` directly.
- Check `aplay -l` — make sure the default audio device is reachable from the user session.

## Do Not

- **Do not** make the external sidecar required for local dashboard playback. It must remain strictly additive.
- **Do not** speak `details` text or full agent stdout — utterances must be short, human-friendly, and interruptible.
- **Do not** re-emit TTS events back into pan. The feed is one-way.

## Related Docs

- `docs/EXTERNAL-EVENT-STREAM.md` — the public contract this skill depends on
- `packages/contracts/src/events.ts` — canonical event schemas
- `skills/pan-tts/scripts/tts_daemon.py` — Qwen3-TTS HTTP daemon source
