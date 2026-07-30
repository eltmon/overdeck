# Kimi Code CLI wire.jsonl fixture (PAN-1837, wi-fixture)

Captured against the real installed `kimi` binary, version 0.29.2
(`~/.kimi-code/bin/kimi`), on 2026-07-28.

## How it was captured

Two non-interactive turns against the same session in a throwaway scratch
directory (`/tmp/kimi-fixture-scratch`, not part of this repo):

```bash
mkdir /tmp/kimi-fixture-scratch && cd /tmp/kimi-fixture-scratch
echo "hello world" > sample.txt

kimi -p "Read the file sample.txt in this directory using your file read tool and tell me what it says."
# -> session_1fc830f7-151f-477c-ae4a-571dfee57723

kimi -p "Now create a file named result.txt containing the word 'done', using your file write tool, then confirm." \
  -S session_1fc830f7-151f-477c-ae4a-571dfee57723
```

`-p`/`--prompt` (single non-interactive prompt) was used only to capture this
fixture deterministically without driving a live TUI; it is not the harness's
production delivery mechanism (see WI-6/NFR-3 — production delivery is tmux
paste under the PTY supervisor, not `-p`).

## Observed workDirKey format

Kimi derives the session directory name from the working directory:

```
sessions/wd_<sanitized-basename>_<12-hex-char-hash>/<sessionId>/agents/main/wire.jsonl
```

For this fixture: `wd_kimi-fixture-scratch_ef33f89ad7cf`, where
`kimi-fixture-scratch` is the scratch directory's basename and
`ef33f89ad7cf` is a stable hash of its absolute path (confirmed against
several other pre-existing real sessions on this machine, e.g.
`wd_overdeck_b289e7acb782`, `wd_feature-pan-2858_1dc66dc5021d` — the pattern
holds regardless of directory name shape).

Note the directory component is `<sessionId>` (e.g.
`session_1fc830f7-151f-477c-ae4a-571dfee57723`), not the bare UUID — the
`session_` prefix is part of the on-disk directory name.

## Layout

```
tests/fixtures/kimi/
├── wire.jsonl                                                    # flat copy, convenience path
├── state.json                                                    # flat copy, convenience path
└── sessions/
    └── wd_kimi-fixture-scratch_ef33f89ad7cf/
        └── session_1fc830f7-151f-477c-ae4a-571dfee57723/
            ├── state.json
            └── agents/
                └── main/
                    └── wire.jsonl
```

The nested `sessions/...` copy preserves the real on-disk layout the
resolver (wi8a) walks. The flat top-level copies are for parser tests
(wi8b) that only need the wire.jsonl content, not path resolution.

## Content

38 lines, 2 `turn.prompt` events (multi-turn), 2 `tool.call`/`tool.result`
pairs (`Read` then `Write`), and 4 `usage.record` events each carrying
`inputCacheRead`/`inputCacheCreation` fields — Kimi's server-side context
cache accounting, the reason this issue drives Kimi natively instead of
through the Anthropic-compatibility shim.

`config.update`'s `systemPrompt` and `llm.tools_snapshot`'s `tools` array
were truncated to short placeholders before committing — the real values
are Kimi's ~50KB built-in system prompt and full tool-schema catalog
(including this machine's locally discovered skills), which have no bearing
on exercising the wire.jsonl parser and would otherwise bloat this fixture
and embed unrelated local-machine detail. No other fields were altered.
