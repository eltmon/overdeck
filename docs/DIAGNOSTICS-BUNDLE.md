# The `pan diagnose` Diagnostic Bundle (PAN-4643)

When Overdeck breaks, `pan diagnose` collects everything a model needs to
find and fix the problem, then — with your consent — starts Claude Code or
Codex to do it. It works even when the dashboard, the supervisor, or Herdr
is down, because that's when you need it most.

## What it does

1. Picks a harness: your `--harness` flag (validated), or a short menu when
   you have more than one of Claude Code / Codex installed and signed in.
2. Asks what went wrong, unless you passed `--describe`.
3. Collects system info, config, logs, and a `pan doctor --json` report —
   concurrently, each wrapped so one failing check never aborts the rest.
4. Redacts every file it collected and writes them to a new bundle
   directory under `~/.overdeck/diagnostics/` (see below).
5. With `--bundle-only`, stops here and prints the bundle's path. Otherwise
   it prints the bundle's path and file list, asks you to confirm, and only
   then starts the harness in that directory with a prompt that tells it to
   read the bundle first.

## Flags

| Flag | What it does |
| --- | --- |
| `--harness <claude-code\|codex>` | Choose the harness explicitly. Validated before anything is collected — an ineligible harness fails fast with the install/sign-in fix, and no bundle is written. |
| `--describe <text>` | What went wrong, in your own words. Saved (redacted) as `description.md`. |
| `--bundle-only` | Write the bundle and print its path. Never prompts for or starts a harness. |
| `--no-issue` | The launched session will not draft or create an upstream `eltmon/overdeck` issue, even if it finds a bug. |
| `--yes` | Start the harness without asking you to confirm the bundle first. |

## The bundle

Every bundle is a new directory `~/.overdeck/diagnostics/<stamp>/` (honours
`OVERDECK_HOME`), named `<stamp>` = UTC `YYYYMMDDTHHMMSSZ` (for example
`20261101T044453Z`; a colliding stamp gets a `-2`, `-3`, … suffix). The
directory is created `0700` and every file in it `0600`.

| File | What it holds |
| --- | --- |
| `MANIFEST.md` | File list with byte counts and redaction counts, collection failures, what was redacted, what's still in the bundle, and what was never collected. Written last. |
| `PROMPT.md` | The exact prompt given to the launched harness. Written even with `--bundle-only`. |
| `description.md` | Your `--describe` text, or `(no description given)`. |
| `doctor.json` | The parsed `pan doctor --json` report, pretty-printed. |
| `doctor-output.txt` | Only present when `pan doctor --json`'s stdout didn't parse as JSON, or it timed out/crashed: exit code, signal, and capped stdout/stderr. |
| `environment.json` | Overdeck version, build info, OS, Node version, terminal backend, and Claude Code / Codex install + version. |
| `services.json` | Dashboard and supervisor reachability (each probed with a 2s timeout). |
| `config/config.yaml` | A copy of `<OVERDECK_HOME>/config.yaml`. |
| `config/projects.yaml` | A copy of `<OVERDECK_HOME>/projects.yaml`. |
| `logs/<file>` | A bounded tail (at most 48 KiB / 200 lines) of each core log that's present (`dashboard.log`, `supervisor.log`, `deacon.log`, `sync.log`, `hooks.log`, `smee.log`, `auto-approve.log`) plus the 3 most recently modified other `.log`/`.jsonl` files. |
| `TROUBLESHOOTING.md` | A copy of this project's `pan-diagnose` skill, so the harness has the same troubleshooting guide a human operator would use. |

## What's redacted

Every file above passes through redaction before it's written:

- Shape-matched secrets: API keys, tokens, JWTs, AWS access keys, database
  URLs, basic-auth URLs, and private keys.
- Sensitive `NAME=value` assignments and labelled secrets (`token: ...`,
  `password: ...`, and similar).
- Config values (`config/config.yaml`, `config/projects.yaml`) under a
  secret-looking key name — `api_key`, `token`, `secret`, `password`,
  `credential`, `cookie`, and variants — even when the shape-based patterns
  above wouldn't have caught it.
- The home directory path, replaced everywhere with `~`.

Redaction never touches the shared `redactSensitiveText` patterns
(`src/lib/secret-redaction.ts`) — `pan diagnose` builds on them, it doesn't
change them.

## What's still in the bundle

File paths, project names and keys, repository paths, log text, and
hostnames are **not** redacted — review the bundle before sharing it
anywhere outside this machine.

## What's never collected

- `~/.overdeck.env`, `access-tokens.json`, `internal-token`,
  `credentials/`, and any harness credential file.
- Agent transcripts.
- Failed `pan` commands — Overdeck doesn't record them anywhere locally, so
  there is nothing to collect.

## Cleaning up old bundles

`pan diagnose` never prunes `~/.overdeck/diagnostics/` automatically.
Delete old bundle directories yourself when you no longer need them.
