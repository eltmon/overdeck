# Changelog

## Unreleased

### Changed

- OpenAI model routing now requires Codex/ChatGPT subscription auth through CLIProxy; direct OpenAI API-key fallback is deprecated because api.openai.com is not Anthropic-compatible.
- Kimi models now launch through Claude Code directly, selecting the Kimi coding or Moonshot Anthropic endpoint from the configured key prefix.
- Z.AI / GLM models now launch through Claude Code directly against Z.AI's Anthropic-compatible endpoint.
- MiniMax models now launch through Claude Code directly against MiniMax's Anthropic-compatible endpoint.
- Mimo models now launch through Claude Code directly against Xiaomi MiMo's Anthropic-compatible endpoint.
- OpenRouter models now launch through Claude Code directly against OpenRouter's Anthropic-compatible endpoint while preserving slash-containing model IDs.

## [0.7.0] — Command Taxonomy Reorganization

### Breaking Changes

The `pan` command surface has been reorganized around a five-bucket taxonomy.
All plumbing commands move under `pan admin`. Lifecycle commands lose the `pan work` prefix.

**Migration table:**

| Legacy | New |
|---|---|
| `pan work issue <id>` | `pan start <id>` |
| `pan work plan <id>` | `pan plan <id>` |
| `pan plan-finalize <id>` | `pan plan finalize <id>` |
| `pan work list` / `pan work triage` | `pan issues` |
| `pan work tell <id>` | `pan tell <id>` |
| `pan work kill <id>` | `pan kill <id>` |
| `pan work resume <id>` | `pan resume <id>` |
| `pan work recover <id>` | `pan recover <id>` |
| `pan work done <id>` | `pan done <id>` |
| `pan work approve <id>` | `pan approve <id>` |
| `pan work reopen <id>` | `pan reopen <id>` |
| `pan work wipe <id>` | `pan wipe <id>` |
| `pan work sync-main <id>` | `pan sync-main <id>` |
| `pan inspect <id>` | `pan inspect <id>` *(unchanged)* |
| `pan work close-out <id>` | `pan close <id>` |
| `pan work pending` | `pan review pending` |
| `pan work request-review <id>` | `pan review request <id>` |
| `pan work reset-review <id>` | `pan review reset <id>` |
| `pan work reset-session <id>` | `pan review reset <id> --session` |
| `pan work shadow <id>` | `pan show <id>` |
| `pan work cv <id>` | `pan show <id> --cv` |
| `pan work context <id>` | `pan show <id> --context` |
| `pan work health <id>` | `pan show <id> --health` |
| `pan work refresh <id>` | `pan show <id>` *(refresh implicit)* |
| `pan work list` | `pan issues` |
| `pan work triage` | `pan issues` |
| `pan cloister *` | `pan admin cloister *` |
| `pan specialists *` | `pan admin specialists *` |
| `pan remote *` | `pan admin remote *` |
| `pan db *` | `pan admin db *` |
| `pan beads *` | `pan admin beads *` |
| `pan config *` | `pan admin config *` |
| `pan setup hooks` | `pan admin hooks install` |
| `pan work hook *` | `pan admin fpp *` |
| `pan work tldr *` | `pan admin tldr *` |
| `pan work linear-states` | `pan admin tracker linear-states` |
| `pan work linear-cleanup` | `pan admin tracker linear-cleanup` |
| `pan migrate-config` | `pan admin migrate-config` |
| `pan sync-costs` | `pan cost sync` |

### New Commands

- `pan show <id>` — Unified observation: shadow state, CV, context, health in one command
  - `--cv` — agent work history only
  - `--context` — context engineering state
  - `--health` — health + heartbeat only
- `pan review pending` — Completed work awaiting review
- `pan review request <id>` — Request re-review after fixing feedback
- `pan review reset <id>` — Reset review/test/merge cycles
  - `--session` — also clears saved Claude session
- `pan issues` — List and triage work across configured trackers
- `pan plan <id>` — Create execution plan (was `pan work plan`)
- `pan plan finalize <id>` — Materialize plan to beads (was `pan plan-finalize`)

### Changes

- `pan admin` namespace introduced for all plumbing commands
- Dashboard HTTP routes renamed: `/api/work/*` → `/api/issues/*`, `/api/review/*`, `/api/show/*`, `/api/admin/*`
- All distributed Claude Code skills renamed to match new CLI verbs
- Umbrella `/pan` skill added to Claude Code for single entry point
- First-launch upgrade announcement banner added to dashboard

### Deprecations Removed

- `pan work` command group (no stub — `pan work <anything>` is an unknown command)
- Top-level `pan cloister`, `pan specialists`, `pan remote`, `pan db`, `pan beads`, `pan config`, `pan migrate-config`
- `pan setup hooks` (replaced by `pan admin hooks install`)
- `pan plan-finalize` (replaced by `pan plan finalize`)
- `pan sync-costs` (replaced by `pan cost sync`)
