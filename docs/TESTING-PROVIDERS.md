# Provider Testing Guide

Guide for testing Panopticon's provider routing with both the Claude Code and Pi harnesses.

## Provider Compatibility Overview

| Provider | Compatibility | Testing Status | Notes |
|----------|---------------|----------------|-------|
| Anthropic | Direct (native) | ✅ Always works | Default provider |
| Kimi (Moonshot) | Direct | ✅ Tested 2026-01-28 | Anthropic-compatible endpoint; Pi native |
| GLM (Z.AI) | Direct | ✅ Tested 2026-01-28 | Anthropic-compatible endpoint; Pi native |
| OpenAI | CLIProxy sidecar | ✅ Tested | Subscription via Codex CLI / CLIProxy |
| Google Gemini | CLIProxy sidecar | ✅ Tested | API key bridged into CLIProxy |
| MiniMax | Direct | ✅ Tested | Anthropic-compatible endpoint; Pi native |
| MiMo | Direct | ✅ Tested | Anthropic-compatible endpoint; Pi native |
| OpenRouter | Direct | ✅ Tested | Anthropic-compatible endpoint; Pi native |
| Nous Portal | Direct | ✅ Tested | OpenAI-compatible via local adapter; Pi native |
| DashScope | Direct | 🔍 Needs testing | OpenAI-compatible via local adapter; Pi native |

## Prerequisites

### For Direct Providers (Kimi, GLM, MiniMax, MiMo, OpenRouter)

- API key from provider
- No additional setup needed

### For CLIProxy Providers (OpenAI, Google)

- OpenAI: Codex/ChatGPT subscription (OAuth) or OpenAI API key
- Google: `GOOGLE_API_KEY` configured in Settings or `~/.panopticon.env`
- CLIProxyAPI sidecar runs automatically with the dashboard

### For Pi Harness Testing

- Pi installed (`npm install -g @mariozechner/pi-coding-agent`)
- `pan doctor` reports Pi OK
- Panopticon bridges API keys into Pi automatically; no separate Pi auth needed for API-key providers

## Testing Direct Providers

### Test Kimi K2

**Setup:**
```bash
# Add Kimi API key to ~/.panopticon.env
export KIMI_API_KEY="sk-kimi-YOUR_KEY_HERE"
# or KIMI_CODING_API_KEY for coding-endpoint keys
```

**Test Claude Code harness:**
```bash
# Spawn an agent with Kimi via Claude Code
pan start PAN-999 --model kimi-k2.5

# Verify env in tmux session
tmux -L panopticon show-environment -t agent-pan-999 | grep ANTHROPIC
# Expected: ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic (or api.kimi.com/coding for sk-kimi-* keys)
# Expected: ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
```

**Test Pi harness:**
```bash
# Spawn an agent with Kimi via Pi
pan start PAN-999 --harness pi --model kimi-k2.5

# Verify env in tmux session
tmux -L panopticon show-environment -t agent-pan-999 | grep KIMI_API_KEY
# Expected: KIMI_API_KEY=sk-kimi-YOUR_KEY_HERE
```

**Expected Result:** Agent responds using Kimi's API regardless of harness.

### Test GLM (Z.AI)

**Setup:**
```bash
# Add Z.AI API key to ~/.panopticon.env
export ZAI_API_KEY="YOUR_ZAI_API_KEY"
```

**Test via Panopticon agent:**
```bash
pan start PAN-998 --model glm-4.7
# Verify: ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
# Verify: API_TIMEOUT_MS=300000
```

## Testing CLIProxy Providers

### Test OpenAI (Codex subscription)

**Setup:**
```bash
# Authenticate via Codex CLI
pan admin specialists codex login
# or: Dashboard → Settings → Codex Login
```

**Test via Panopticon agent:**
```bash
pan start PAN-997 --model gpt-5.4

# Verify: ANTHROPIC_BASE_URL points to CLIProxy sidecar
# Verify: No ANTHROPIC_AUTH_TOKEN (subscription auth is session-based via CLIProxy)
```

### Test Google Gemini

**Setup:**
```bash
export GOOGLE_API_KEY="AIza..."
```

**Test via Panopticon agent:**
```bash
pan start PAN-996 --model gemini-3.1-pro-preview

# Verify: ANTHROPIC_BASE_URL points to CLIProxy Gemini backend
```

## Testing Pi Harness

### Pi with API-key providers

For all API-key providers, Panopticon automatically injects the native env var
into Pi's environment at launch. You do **not** need to run `/login` inside Pi
or edit `~/.pi/agent/auth.json` manually.

| Provider | Panopticon Config | Pi Env Var Injected |
|----------|-------------------|---------------------|
| Kimi | `api_keys.kimi` or `KIMI_API_KEY` | `KIMI_API_KEY` |
| MiniMax | `api_keys.minimax` or `MINIMAX_API_KEY` | `MINIMAX_API_KEY` |
| Z.AI | `api_keys.zai` or `ZAI_API_KEY` | `ZAI_API_KEY` |
| MiMo | `api_keys.mimo` or `MIMO_API_KEY` | `MIMO_API_KEY` |
| OpenRouter | `api_keys.openrouter` or `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| Nous | `api_keys.nous` or `NOUS_API_KEY` | `NOUS_API_KEY` |
| DashScope | `api_keys.dashscope` or `DASHSCOPE_API_KEY` | `DASHSCOPE_API_KEY` |
| Google | `api_keys.google` or `GOOGLE_API_KEY` | `GEMINI_API_KEY` |

**Test:**
```bash
# Ensure Pi is installed
pan doctor

# Spawn a Pi work agent with Kimi
pan start PAN-995 --harness pi --model kimi-k2.5

# Attach to tmux session and inspect env
tmux -L panopticon show-environment -t agent-pan-995
# Should contain: KIMI_API_KEY=...
```

### Pi with subscription providers

Pi with Anthropic or OpenAI subscription auth requires separate Pi-side auth:

```bash
# Inside a Pi session
/login
# → Select subscription provider (Anthropic / OpenAI)
```

## Integration Testing

### Test Agent Spawning with Different Providers

**Test 1: Spawn agent with Anthropic (control)**
```bash
pan start PAN-999 --model claude-sonnet-4-5
# Verify: Agent spawns normally
# Verify: No custom env vars set
```

**Test 2: Spawn agent with Kimi via Claude Code**
```bash
pan start PAN-998 --model kimi-k2.5
# Verify in agent env:
# - ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic (or api.kimi.com/coding)
# - ANTHROPIC_AUTH_TOKEN=sk-kimi-...
# - Agent responds using Kimi's API
```

**Test 3: Spawn agent with Kimi via Pi**
```bash
pan start PAN-997 --harness pi --model kimi-k2.5
# Verify in agent env:
# - KIMI_API_KEY=sk-kimi-...
# - Agent responds using Kimi's API through Pi
```

**Test 4: Spawn agent with GLM via Claude Code**
```bash
pan start PAN-996 --model glm-4.7
# Verify in agent env:
# - ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
# - ANTHROPIC_AUTH_TOKEN=...
# - API_TIMEOUT_MS=300000
```

**Test 5: Spawn agent with OpenAI (CLIProxy)**
```bash
pan start PAN-995 --model gpt-5.4
# Verify in agent env:
# - ANTHROPIC_BASE_URL=http://127.0.0.1:8317 (CLIProxy)
# - No ANTHROPIC_AUTH_TOKEN (subscription auth via CLIProxy)
```

## Troubleshooting

### Direct Provider Issues

**Problem:** 401 Authentication Error
- Check API key is valid
- Verify API key has correct format
- Confirm provider account has credits

**Problem:** Connection timeout
- Check base URL is correct
- Verify network connectivity
- For GLM: Ensure API_TIMEOUT_MS is set

**Problem:** "No API key found for kimi-coding" (Pi)
- Verify `KIMI_API_KEY` is set in `~/.panopticon.env` or dashboard Settings
- Verify the agent was spawned with `--harness pi`
- Check `tmux -L panopticon show-environment -t agent-<id>` for `KIMI_API_KEY`

### CLIProxy Provider Issues

**Problem:** CLIProxy not responding
```bash
# Check if CLIProxy is running
ps aux | grep cliproxy

# Restart dashboard (CLIProxy starts with it)
pan down && pan up
```

### Pi Harness Issues

**Problem:** Pi spawns but provider auth fails
- Verify the provider API key is configured in Panopticon Settings
- Pi auth is bridged automatically; manual `/login` in Pi is only needed for subscription providers
- Check `~/.pi/agent/auth.json` only if you intentionally want Pi-managed auth separate from Panopticon

## Test Checklist

### Direct Provider Testing
```
[ ] API key configured in Settings or ~/.panopticon.env
[ ] Claude Code harness test successful
[ ] Pi harness test successful (if applicable)
[ ] Agent spawning with provider works
[ ] Provider dashboard shows usage
[ ] Error handling works (invalid key, etc.)
```

### CLIProxy Provider Testing
```
[ ] CLIProxy running (check dashboard startup)
[ ] Auth configured (Codex login or API key)
[ ] Agent spawning with provider works
[ ] Provider dashboard shows usage
[ ] Error handling works
```

### Pi Harness Testing
```
[ ] Pi installed and `pan doctor` OK
[ ] API-key provider spawn works without manual `/login`
[ ] Subscription provider spawn works after Pi `/login`
[ ] Env vars bridged correctly (tmux show-environment)
```

## Performance Benchmarks

### Latency Comparison (Expected)

| Provider | Type | First Token | Request Time | Notes |
|----------|------|-------------|--------------|-------|
| Anthropic | Direct | ~500ms | ~2s | Baseline |
| Kimi | Direct | ~600ms | ~2.5s | Similar to Anthropic |
| GLM | Direct | ~700ms | ~3s | Slightly slower |
| OpenAI | CLIProxy | ~800ms | ~3s | +sidecar overhead |
| Gemini | CLIProxy | ~900ms | ~4s | +sidecar overhead |

## Cost Comparison

Track costs across providers:

```bash
# View cost breakdown by provider
pan costs --by-provider

# Expected savings (approximate):
# - Kimi: 70% cheaper than Anthropic
# - GLM: 80% cheaper than Anthropic
# - OpenAI: Varies by model
# - Gemini: Varies by model
```

## Documentation

After testing, update:
- [ ] `docs/CONFIGURATION.md` - Confirm provider compatibility
- [ ] `README.md` - Add provider support section
- [ ] Settings UI - Update compatibility badges
- [ ] This file - Add test results and benchmarks
