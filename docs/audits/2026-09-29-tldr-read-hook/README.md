# TLDR read hook audit (2026-09-29)

Overdeck shipped a Claude Code `PreToolUse` hook, `tldr-read-enforcer`, that blocked a
`Read` of any code file over 3 KB and injected a roughly 1K-token outline of the file
(functions, classes, imports) from [llm-tldr](https://pypi.org/project/llm-tldr/). Its
header claimed it saved "90-95% of context tokens". This audit measured what agents
actually did after a blocked read. The result led to removing TLDR from Overdeck
([PAN-4429](https://github.com/eltmon/overdeck/issues/4429)).

The audit measures Overdeck's hook: deny the read, inject an outline. It does not
measure llm-tldr's other features or every summarize-first design.

## Sample

- 6,564 local Claude Code transcripts from the last 60 days on one development machine
  (main sessions and subagents, all projects).
- 414 blocked reads in 148 sessions, 2026-08-09 to 2026-09-29.
- Mixed models: mostly Claude Sonnet 5, plus MiniMax M3, Kimi, Claude Opus 5.5 and others
  running inside Claude Code. Full breakdown in `results-60d.json`.

## Results (60 days)

| What the agent did within its next 8 tool calls | Share |
| --- | --- |
| Read the same file again with offset/limit | 71.7% |
| Read it through Bash (cat, sed, head, ...) | 13.5% |
| Read it again in full | 3.4% |
| Worked from the outline only | 11.4% |

- 88.6% of blocked reads were followed by a read of the same file.
- 70.7% of the withheld bytes came back into context within 15 tool calls. In 241 of
  414 cases the agent read back at least 80% of the file.
- The injected outlines themselves added about 159K tokens.
- Each re-read cost on average 1.12 extra model turns. An extra turn re-read about
  179K tokens of conversation context (mostly from the prompt cache).
- Cost of the extra turns: 9.9M input-token equivalents. Best-case savings: 3.5M.
  For every token the hook saved, the extra turns cost about 2.8. Net: -6.4M.
- Timing: the hook took about 250 ms per blocked read on this machine, before the
  extra turn.
- Disk: each workspace carried its own ~1.5 GB Python venv (CPU torch + llm-tldr).
  18 copies helped fill a 832 GB disk to 100% on 2026-09-29.

The 14-day window (313 denials, `results-14d.json`) gives the same picture: 92% re-read,
cost 7.9M vs best-case savings 2.9M.

## Method and limits

See the docstring in `audit.py`. The main limits:

- One team, one machine, one hook implementation.
- "Re-read" is matched heuristically (same path, or a Bash read naming the file).
- Tokens are estimated at 4 characters per token for file content; turn costs come
  from the transcripts' real `usage` fields.
- Cost weights use Anthropic's list-price ratios. Non-Anthropic models in the sample
  price differently.
- Savings are an upper bound: they assume withheld content would have stayed in
  context for every remaining turn, ignoring compaction.

## Re-run it

```bash
python3 audit.py 60
```

It reads `~/.claude/projects/**/*.jsonl` and writes only aggregate numbers.
