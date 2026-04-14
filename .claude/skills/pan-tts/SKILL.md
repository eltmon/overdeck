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

`pan-tts` is an **optional** local daemon that subscribes to Panopticon's public SSE feed, filters for `activity.entry` events, and speaks the message aloud using a local text-to-speech engine. It runs as its own process — nothing inside pan depends on it, and pan users who do not want audio notifications will never know it exists.

Default voice stack for this machine is Qwen3-TTS VoiceDesign 1.7B via the existing `stream-voices` rig on the RTX 3090 (see `~/Projects/stream-voices`). Any TTS that takes text on stdin and plays audio on stdout will drop in.

## Why It's a Skill, Not a Core Feature

- Panopticon should not own audio, GPU runtimes, or voice models.
- Users with different TTS preferences (Piper, Coqui, ElevenLabs, macOS `say`) can swap the engine without touching pan.
- The `/events/stream` contract is stable; sidecars built against it keep working across pan upgrades.

See **`docs/EXTERNAL-EVENT-STREAM.md`** for the full event-stream contract.

## How It Works

```
pan dashboard            pan-tts daemon              audio out
─────────────────        ─────────────────           ─────────
/events/stream ──SSE──▶  filter activity.entry ──▶  Qwen3-TTS ──▶  speaker
                         dedupe by sequence
                         priority queue
```

1. Connects to `http://127.0.0.1:3000/events/stream?types=activity.entry` with `EventSource` semantics.
2. On each event, formats a condensed utterance: `"<source>: <message>"` (e.g. `"merge agent: PAN-537 merged"`). Full `details` text is never spoken — keep utterances short.
3. Enqueues into a priority queue:
   - `level: error` → interrupt current speech
   - `level: warn | success` → normal queue
   - `level: info` → low priority, drop if queue > 5 items
4. Synthesizes with the configured TTS engine and plays through the default audio device.
5. Persists the last processed `sequence` to `~/.pan-tts/state.json` so restarts replay missed events via `Last-Event-ID`.

## Configuration

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
  max_depth: 8
  drop_info_when_full: true
```

Secrets (if any) go in `~/.panopticon.env` alongside the rest of the pan environment — do not duplicate them here.

## Running It

The daemon ships as a small Python project at `~/Projects/pan-tts/` (to be created after the `/events/stream` endpoint lands).

```bash
# one-shot foreground run (smoke test)
cd ~/Projects/pan-tts
uv run pan-tts

# systemd user unit for permanent install
systemctl --user enable --now pan-tts.service
```

A `pan-tts.service` unit template lives at `~/Projects/pan-tts/systemd/pan-tts.service` — `User=` and `WorkingDirectory=` are pre-filled for this machine.

## Ad-Hoc Speak (For Agents)

The skill bundles `scripts/say.sh` for one-off utterances — agents can use this to announce build completions, merge outcomes, or attention requests without routing through the dashboard event store:

```bash
./scripts/say.sh "Build is green, ready for review."
./scripts/say.sh "Pan 672 merged to main."
```

The script POSTs to the local Qwen3-TTS daemon at `http://127.0.0.1:8787/speak` (override via `QWEN_TTS_ENDPOINT`). It returns immediately after queuing — audio plays asynchronously through the daemon's worker thread. Keep utterances short (under ~200 characters); the daemon's queue caps at 6.

Use this sparingly — the SSE-subscribed sidecar already speaks every activity entry. Ad-hoc speak is for:
- Announcements that don't warrant a dashboard activity entry (local test runs, meta-commentary)
- Pulling the user's attention during long-running work
- Testing the audio path after a restart

## Verifying It

1. `pan up` — start the dashboard.
2. `systemctl --user start pan-tts` — start the sidecar.
3. `journalctl --user -u pan-tts -f` — watch logs.
4. In another terminal: `pan work issue PAN-XXX` and listen. You should hear the merge agent, review specialist, etc. as they post activity entries.

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
- `~/Projects/stream-voices` — the underlying Qwen3-TTS rig
