---
name: pan-tts
description: Optional local text-to-speech sidecar that speaks Panopticon activity log entries through Qwen3-TTS (or any local TTS engine). Subscribes to the public /events/stream SSE feed; no pan-core dependency. Also exposes an ad-hoc speak helper (scripts/say.sh) so agents can announce one-off messages on demand.
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

# pan-tts — Panopticon Activity TTS Sidecar

**Status: reference sidecar for the External Event Stream (spec stage).** Enable once the `/events/stream` endpoint has shipped.

## What It Is

`pan-tts` is an **optional** local sidecar that subscribes to Panopticon's public SSE feed, filters for `activity.entry` events, and speaks the message aloud using a local text-to-speech engine. It runs as its own process — nothing inside pan depends on it, and pan users who do not want audio notifications will never know it exists.

The TTS pipeline is split into two independent components:

1. **Qwen3-TTS HTTP daemon** (`skills/pan-tts/scripts/tts_daemon.py`) — keeps the 1.7B model resident in VRAM, synthesizes speech on demand via `POST /speak`, and plays audio through the default PipeWire sink. This is the component that actually drives the speaker.
2. **SSE subscriber** (`~/Projects/pan-tts/`) — connects to Panopticon's `/events/stream`, formats condensed utterances, and forwards them to the daemon. This is the component that decides *what* to speak.

## Architecture

```
pan dashboard            pan-tts subscriber          qwen-tts daemon            audio out
─────────────────        ───────────────────         ─────────────────          ─────────
/events/stream ──SSE──▶  filter activity.entry  ──▶  POST /speak  ──▶         PipeWire
                         dedupe by sequence          synthesize (GPU)
                         priority queue              persistent pw-play stream
```

### Why two components?

- The GPU daemon is expensive to start (model load ~10s) and must stay resident.
- The subscriber is cheap to restart and can be swapped for a different consumer (Discord bot, desktop notification, etc.) without touching the GPU runtime.
- The `/speak` contract is simple HTTP; anything that can POST JSON can use the daemon.

## Qwen3-TTS HTTP Daemon

**Source:** `skills/pan-tts/scripts/tts_daemon.py`

The daemon loads `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` on `cuda:0` at startup and exposes three endpoints:

- `POST /speak` — queue a text utterance for synthesis and playback
- `POST /extract-embedding` — generate a VoiceDesign audio clip and extract a 2048-dim speaker embedding for voice cloning
- `GET /health` — queue depth and model status

### Running the daemon

```bash
cd skills/pan-tts/scripts
# assumes the qwen-tts venv is active (see eltmon-stream setup)
python tts_daemon.py
```

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
  types: [activity.entry]
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

Use ad-hoc speak sparingly — the dashboard or SSE-subscribed sidecar already speaks activity entries. Ad-hoc speak is for:
- Announcements that don't warrant a dashboard activity entry (local test runs, meta-commentary)
- Pulling the user's attention during long-running work
- Testing the audio path after a restart

## Verifying It

1. `pan up` — start the dashboard.
2. Start the Qwen3-TTS daemon: `cd skills/pan-tts/scripts && python tts_daemon.py`
3. Start the sidecar: `systemctl --user start pan-tts`
4. `journalctl --user -u pan-tts -f` — watch logs.
5. In another terminal: `pan start PAN-XXX` and listen. You should hear the merge agent, review specialist, etc. as they post activity entries.

If nothing speaks:

- Check `curl -N http://127.0.0.1:3000/events/stream?types=activity.entry` directly. If that is empty, the issue is pan-side (endpoint or event emission).
- Check `~/.pan-tts/state.json` — if `last_sequence` is advancing but no audio, the issue is in the TTS engine.
- Check `aplay -l` — make sure the default audio device is reachable from the user session.

## Do Not

- **Do not** make pan core depend on this. No import, no config key, no menu item, no health check. The sidecar must be strictly additive.
- **Do not** speak `details` text or full agent stdout — utterances must be short, human-friendly, and interruptible.
- **Do not** re-emit TTS events back into pan. The feed is one-way.

## Related Docs

- `docs/EXTERNAL-EVENT-STREAM.md` — the public contract this skill depends on
- `packages/contracts/src/events.ts` — canonical event schemas
- `skills/pan-tts/scripts/tts_daemon.py` — Qwen3-TTS HTTP daemon source
