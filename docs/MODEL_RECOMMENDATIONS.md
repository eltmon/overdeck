# Panopticon Model Recommendations

Practical guidance for choosing models by job type, not by hype cycle.

This document complements [WORK-TYPES.md](./WORK-TYPES.md). Use it when you want to decide which model family should own implementation, review, helper agents, or CLI work.

## Default Strategy

Panopticon’s current default posture is:

- **Protect planning and security with Anthropic**
- **Use a high-value coding model for implementation**
- **Keep helper agents fast and cheap**
- **Override only the jobs you actually care about**

That leads to a default shape like this:

| Area | Recommended family | Reason |
|------|--------------------|--------|
| Planning | Claude Opus 4.6 | Strongest architecture and synthesis slot |
| Implementation | Kimi K2.5 or GPT-5.4 | Best value vs capability for code-heavy work |
| Testing | Claude Sonnet 4.6 | Reliable iterative fix loops |
| Security review | Claude Opus 4.6 | Highest-confidence review lane |
| Helper subagents | Claude Haiku 4.5 / GPT-5.4 Nano / Gemini Flash | Low cost, high speed |
| Interactive CLI | Claude Sonnet 4.6 or GPT-5.4 | Good mixed reasoning plus coding |

---

## By Workflow Goal

### 1. Best overall quality

Use this when correctness matters more than cost.

- `planning-agent`: `claude-opus-4-6`
- `issue-agent:implementation`: `gpt-5.4-pro` or `gpt-5.4`
- `issue-agent:testing`: `gpt-5.4` or `claude-sonnet-4-6`
- `specialist-review-agent`: `claude-opus-4-6`
- `convoy:security-reviewer`: `claude-opus-4-6`
- `convoy:synthesis-agent`: `claude-opus-4-6`

### 2. Best value

Use this when you want strong output without premium pricing everywhere.

- `planning-agent`: `claude-opus-4-6`
- `issue-agent:implementation`: `kimi-k2.5`
- `issue-agent:testing`: `claude-sonnet-4-6`
- `issue-agent:documentation`: `claude-sonnet-4-6`
- `subagent:*`: `claude-haiku-4-5`
- `cli:quick-command`: `claude-haiku-4-5`

### 3. OpenAI-first coding workflow

Use this when you want GPT as the main implementation lane.

- `issue-agent:implementation`: `gpt-5.4`
- `issue-agent:testing`: `gpt-5.4-mini`
- `cli:interactive`: `gpt-5.4`
- `cli:quick-command`: `gpt-5.4-nano`
- Keep security and synthesis on Anthropic unless you have a strong reason not to

### 4. Gemini-heavy large-context workflow

Use this when reading and planning across large surfaces matters more than premium coding benchmarks.

- `planning-agent`: `gemini-3.1-pro-preview`
- `issue-agent:exploration`: `gemini-3-flash`
- `subagent:explore`: `gemini-3-flash`
- `gemini_thinking_level`: `4`

### 5. Cheapest acceptable helper lane

Use this for subagents and quick commands, not core review/security.

- `subagent:explore`: `claude-haiku-4-5`
- `subagent:bash`: `claude-haiku-4-5`
- `cli:quick-command`: `gpt-5.4-nano` or `claude-haiku-4-5`

---

## By Model Family

### Claude Opus 4.6

Best for:

- planning
- architecture
- security review
- correctness review on high-risk changes
- synthesis

Avoid using it for:

- every helper agent
- cheap command loops
- routine documentation unless the docs are unusually complex

### Claude Sonnet 4.6

Best for:

- testing
- documentation
- review response
- merge specialist
- interactive CLI

It is the safest default general-purpose Anthropic slot.

### Claude Haiku 4.5

Best for:

- quick commands
- helper subagents
- cheap exploration

Do not make it your main security or merge-review model unless you are knowingly optimizing for cost over rigor.

### GPT-5.4 / GPT-5.4 Pro

Best for:

- implementation
- refactors
- hard debugging
- large-context code editing

Use `gpt-5.4-pro` when you want the highest-end OpenAI slot and cost is secondary.

### O3 / O4 Mini

Best for:

- deliberate reasoning
- debugging and deep analysis
- jobs where you care more about thoughtfulness than raw speed

`o4-mini` is the cheaper choice; `o3` is the heavier reasoning slot.

### GPT-5.4 Mini / Nano

Best for:

- faster implementation loops
- quick CLI usage
- cheaper helper agents

`gpt-5.4-nano` is especially good for low-stakes quick command paths.

### Gemini 3.1 Pro / Gemini 3 Flash

Best for:

- large-context planning
- reading broad surfaces
- cost-conscious analysis

Flash is usually the better exploration slot; Pro is the better planning slot.

### Kimi K2.5

Best for:

- value-oriented implementation
- code-heavy execution
- shops that want premium coding without premium pricing everywhere

Kimi is one of the best places to save money without collapsing implementation quality.

---

## Recommended First Overrides

If you only want to change a few things, start here:

```yaml
models:
  overrides:
    issue-agent:implementation: gpt-5.4
    convoy:security-reviewer: claude-opus-4-6
    cli:quick-command: claude-haiku-4-5
```

Why these three:

- implementation is the most visible quality lever
- security review is the highest-risk review lever
- quick-command controls everyday responsiveness

---

## Recommended Provider Mixes

### Anthropic-only

Good for simplest setup.

- reliable
- minimal configuration
- fallback is trivial

### Anthropic + OpenAI

Best for:

- GPT implementation
- Anthropic review and planning

### Anthropic + Kimi

Best for:

- strong coding value
- simple direct-provider setup

### Anthropic + Google

Best for:

- large-context analysis
- exploration-heavy workflows

---

## Anti-Patterns

Avoid these unless you have a specific reason:

- Putting your cheapest model on `convoy:security-reviewer`
- Using the same premium model for every single work type
- Overriding every slot before you learn where the bottleneck actually is
- Optimizing `cli:quick-command` for depth instead of speed

---

## Example Configs

### Premium coding, Anthropic reviews

```yaml
models:
  providers:
    anthropic:
      enabled: true
    openai:
      enabled: true
      auth: subscription

  overrides:
    issue-agent:implementation: gpt-5.4
    issue-agent:testing: gpt-5.4-mini
    specialist-review-agent: claude-opus-4-6
    convoy:security-reviewer: claude-opus-4-6
```

### Value-first setup

```yaml
models:
  providers:
    anthropic:
      enabled: true
    kimi:
      enabled: true
      api_key: $KIMI_API_KEY

  overrides:
    issue-agent:implementation: kimi-k2.5
    specialist-review-agent: claude-sonnet-4-6
    convoy:security-reviewer: claude-opus-4-6
    cli:quick-command: claude-haiku-4-5
```

### Large-context analysis setup

```yaml
models:
  providers:
    anthropic:
      enabled: true
    google:
      enabled: true
      auth: api-key
      api_key: $GOOGLE_API_KEY

  overrides:
    planning-agent: gemini-3.1-pro-preview
    issue-agent:exploration: gemini-3-flash

  gemini_thinking_level: 4
```

---

## Related Docs

- [CONFIGURATION.md](./CONFIGURATION.md)
- [WORK-TYPES.md](./WORK-TYPES.md)
