# Panopticon Work Types

Reference for the job settings Panopticon uses for model routing.

This document is about **routed work types and model-selection slots**, not the high-level roster of Panopticon runtime agents. Use [AGENT_TYPES_INDEX.md](./AGENT_TYPES_INDEX.md) if you want the newcomer-friendly map of what kinds of agents exist.

Each work type is a routable job slot. You can override any of these IDs in `models.overrides` inside `~/.panopticon/config.yaml` or `.pan.yaml`.

## Overview

- Panopticon currently routes **23 router-backed work types**
- Work types are grouped by workflow role, not by provider
- Capability-based selection picks defaults automatically
- Overrides let you pin any one work type to any supported model

Example:

```yaml
models:
  overrides:
    issue-agent:implementation: gpt-5.4
    convoy:security-reviewer: claude-opus-4-6
    cli:quick-command: claude-haiku-4-5
```

---

## Issue Agent Phases

These are the phases inside the main issue worker.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `issue-agent:exploration` | First pass through the codebase, requirements, and surrounding context | `claude-opus-4-6` | Use Gemini for large-context scanning or Haiku for cheaper discovery |
| `issue-agent:implementation` | Main code-writing phase | `kimi-k2.5` | Use GPT-5.4 for premium coding or Sonnet for Anthropic-only shops |
| `issue-agent:testing` | Test loops, failing test repair, coverage work | `claude-sonnet-4-6` | Use GPT-5.4 Mini or GPT-5.4 if you prefer OpenAI for iterative fix loops |
| `issue-agent:documentation` | README updates, migrations, comments, supporting docs | `claude-sonnet-4-6` | Use Gemini or GPT if you want one provider across all issue-agent work |
| `issue-agent:review-response` | Follow-up fixes after review feedback | `claude-sonnet-4-6` | Use GPT-5.4 when review feedback tends to require code-heavy refactors |

### Guidance

- Override `issue-agent:implementation` first if you only care about one slot.
- Keep `issue-agent:exploration` on a high-context or high-reasoning model for unfamiliar codebases.
- Keep `issue-agent:testing` on a model that is fast enough for retry loops.

---

## Specialist Agents

These are dedicated long-running workflow stages.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `specialist-review-agent` | Dedicated review pass before merge | `claude-opus-4-6` | Lower to Sonnet if you want to reduce cost on routine repos |
| `specialist-test-agent` | Dedicated test specialist pass | `claude-sonnet-4-6` | Raise to GPT-5.4 for harder debugging-heavy test suites |
| `specialist-merge-agent` | Merge prep, merge-time validation, conflict handling | `claude-sonnet-4-6` | Raise to Opus for very risky multi-repo or conflict-heavy workflows |
| `specialist-inspect-agent` | Per-bead inspection gate during implementation | `claude-sonnet-4-6` | Raise to Opus when spec fidelity is critical or diffs are complex |
| `specialist-uat-agent` | Browser-based user acceptance testing after tests pass | `claude-sonnet-4-6` | Raise to Opus for high-stakes UX validation or complex product flows |

### Guidance

- Keep review and merge on cautious models.
- If CI is noisy or flaky, upgrading `specialist-test-agent` can save time.

---

## Subagents

These are smaller helper jobs spawned for focused tasks.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `subagent:explore` | Fast helper for reading/searching | `claude-haiku-4-5` | Use Gemini Flash or GPT-5.4 Nano for cheaper/faster helper work |
| `subagent:plan` | Helper for approach sketches and breakdowns | `claude-haiku-4-5` | Use Sonnet or Gemini Pro if these plans need more rigor |
| `subagent:bash` | Shell-heavy helper work | `claude-haiku-4-5` | Use GPT-5.4 Mini if your bash helpers also need better code reasoning |
| `subagent:general-purpose` | Mixed helper tasks that are not obviously one category | `claude-sonnet-4-6` | Use GPT-5.4 or Gemini Pro for richer multi-step side tasks |

### Guidance

- These are good slots for cheap models.
- If a helper starts writing substantial code, prefer `subagent:general-purpose` over the ultra-fast slots.

---

## Convoy Reviewers

Convoy work types run parallel review passes with different review lenses.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `convoy:security-reviewer` | Security-focused parallel review | `claude-opus-4-6` | Only lower this if you knowingly accept more review risk |
| `convoy:performance-reviewer` | Performance-focused parallel review | `claude-sonnet-4-6` | Use Gemini Pro if you want cheaper algorithm and perf analysis |
| `convoy:correctness-reviewer` | Logic and correctness review | `claude-sonnet-4-6` | Raise to Opus for bug-prone or safety-critical code |
| `convoy:requirements-reviewer` | Requirement/design alignment review | capability-based | Pin Sonnet or Opus when requirement drift is a recurring issue |
| `convoy:synthesis-agent` | Final combined summary of convoy findings | `claude-sonnet-4-6` | Raise to Opus when you want the most careful synthesis pass |

### Guidance

- Security and synthesis are the convoy slots most worth upgrading.
- Performance review is often a good place to save cost if you already trust your benchmark/test loop.

---

## Planning

The planning phase is separate from the issue-agent implementation loop.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `planning-agent` | Up-front planning and vBRIEF generation | capability-based, usually `claude-opus-4-6` | Use Gemini Pro for cheaper large-context planning or GPT-5.4 for a more code-shaped planning style |
| `status-review` | Executive-style planning progress summaries in Mission Control | `claude-sonnet-4-6` | Raise to Opus if you want deeper requirement-to-progress analysis |

### Guidance

- This is the slot to protect if architecture quality matters.
- Planning quality usually matters more than saving a small amount of cost here.

---

## CLI Modes

These control Panopticon’s direct user-facing CLI interactions.

| Work type | When it runs | Typical default | Why you might override it |
|-----------|--------------|-----------------|---------------------------|
| `cli:interactive` | Ongoing interactive CLI conversations | `claude-sonnet-4-6` | Use GPT-5.4 if you want OpenAI as the primary daily driver |
| `cli:quick-command` | Short one-shot commands and small utility requests | `claude-haiku-4-5` | Use GPT-5.4 Nano or Gemini Flash Lite if speed or cost matters more |

### Guidance

- `cli:interactive` should feel reliable and context-aware.
- `cli:quick-command` should feel fast.

---

## Common Override Patterns

### Premium implementation

```yaml
models:
  overrides:
    issue-agent:implementation: gpt-5.4
    issue-agent:testing: gpt-5.4-mini
```

### Anthropic-heavy reviews, cheaper helpers

```yaml
models:
  overrides:
    specialist-review-agent: claude-opus-4-6
    convoy:security-reviewer: claude-opus-4-6
    subagent:explore: claude-haiku-4-5
    cli:quick-command: claude-haiku-4-5
```

### Kimi implementation lane

```yaml
models:
  overrides:
    issue-agent:implementation: kimi-k2.5
```

### Gemini planning lane

```yaml
models:
  overrides:
    planning-agent: gemini-3.1-pro-preview
    issue-agent:exploration: gemini-3-flash

  gemini_thinking_level: 4
```

---

## Choosing What to Override

If you want the smallest useful set of overrides:

1. Override `issue-agent:implementation`
2. Override `convoy:security-reviewer`
3. Override `cli:quick-command`

That covers the three most noticeable user tradeoffs:

- coding quality
- review rigor
- day-to-day responsiveness

---

## Related Docs

- [CONFIGURATION.md](./CONFIGURATION.md) for provider auth and YAML examples
- [MODEL_RECOMMENDATIONS.md](./MODEL_RECOMMENDATIONS.md) for higher-level model guidance
