# Provider Testing Guide

Guide for testing Panopticon's hybrid provider approach with direct APIs and claude-code-router.

## Provider Compatibility Overview

| Provider | Compatibility | Testing Status | Notes |
|----------|---------------|----------------|-------|
| Anthropic | Direct (native) | ✅ Always works | Default provider |
| Kimi (Moonshot) | Direct | ✅ Tested 2026-01-28 | Uses Anthropic-compatible API |
| GLM (Z.AI) | Direct | ✅ Tested 2026-01-28 | Uses Anthropic-compatible API |
| OpenAI | Router | 🔍 Needs testing | Requires claude-code-router |
| Google Gemini | Router | 🔍 Needs testing | Requires claude-code-router |

## Prerequisites

### For Direct Providers (Kimi, GLM)
- API key from provider
- No additional setup needed

### For Router Providers (OpenAI, Gemini)
- API key from provider
- claude-code-router installed (`npm install -g @musistudio/claude-code-router`)
- Router running on localhost:8000

## Testing Direct Providers

### Test Kimi K2

**Setup:**
```bash
# Create test settings
cat > ~/.panopticon/settings.json << 'EOF'
{
  "models": {
    "specialists": {
      "review_agent": "claude-sonnet-4-5",
      "test_agent": "claude-sonnet-4-5",
      "merge_agent": "claude-sonnet-4-5"
    },
    "planning_agent": "claude-sonnet-4-5",
    "complexity": {
      "trivial": "claude-haiku-4-5",
      "simple": "claude-haiku-4-5",
      "medium": "claude-sonnet-4-5",
      "complex": "claude-sonnet-4-5",
      "expert": "claude-opus-4-5"
    }
  },
  "api_keys": {
    "kimi": "sk-kimi-YOUR_KEY_HERE"
  }
}
EOF
```

**Test direct API:**
```bash
# Test Kimi directly with Claude Code
export ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
export ANTHROPIC_AUTH_TOKEN=sk-kimi-YOUR_KEY_HERE
claude "What is 2+2?"
```

**Expected Result:** Response "2+2 equals 4" or similar

**Test via Panopticon agent:**
```bash
# Update settings to use Kimi for test agent
# Then spawn an agent and verify it uses Kimi's API
```

### Test GLM (Z.AI)

**Setup:**
```bash
# Add GLM API key to settings
cat > ~/.panopticon/settings.json << 'EOF'
{
  "models": {
    "specialists": {
      "review_agent": "glm-4.7",
      "test_agent": "glm-4.7",
      "merge_agent": "glm-4.7"
    },
    "planning_agent": "glm-4.7",
    "complexity": {
      "trivial": "glm-4.7-flash",
      "simple": "glm-4.7-flash",
      "medium": "glm-4.7",
      "complex": "glm-4.7",
      "expert": "glm-4.7"
    }
  },
  "api_keys": {
    "zai": "YOUR_ZAI_API_KEY"
  }
}
EOF
```

**Test direct API:**
```bash
# Test GLM directly with Claude Code
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=YOUR_ZAI_API_KEY
export API_TIMEOUT_MS=300000
claude "What is 2+2?"
```

**Expected Result:** Response from GLM-4.7 model

**Verification:**
- Check Z.AI usage dashboard for new requests
- Verify request shows GLM model used

## Testing Router Providers

### Test OpenAI

**Setup:**
```bash
# Install router if not already installed
npm install -g @musistudio/claude-code-router

# Configure router
mkdir -p ~/.claude-code-router
cat > ~/.claude-code-router/config.json << 'EOF'
{
  "providers": [
    {
      "name": "anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "$ANTHROPIC_API_KEY",
      "models": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
    },
    {
      "name": "openai",
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "YOUR_OPENAI_API_KEY",
      "models": ["gpt-5.2-codex", "o3-deep-research", "gpt-4o", "gpt-4o-mini"]
    }
  ],
  "router": {
    "default": "claude-sonnet-4-5"
  }
}
EOF

# Start router
claude-code-router start
```

**Test router API:**
```bash
# Test OpenAI via router
export ANTHROPIC_BASE_URL=http://localhost:8000
export ANTHROPIC_AUTH_TOKEN=router-managed
claude --model gpt-4o "What is 2+2?"
```

**Expected Result:** Response from GPT-4o via router translation

**Verification:**
- Check router logs for API translation
- Verify OpenAI API call in OpenAI usage dashboard
- Confirm response format matches Claude Code expectations

### Test Google Gemini

**Setup:**
```bash
# Update router config to include Gemini
cat > ~/.claude-code-router/config.json << 'EOF'
{
  "providers": [
    {
      "name": "anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "$ANTHROPIC_API_KEY",
      "models": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
    },
    {
      "name": "google",
      "baseURL": "https://generativelanguage.googleapis.com/v1beta",
      "apiKey": "YOUR_GOOGLE_API_KEY",
      "models": ["gemini-3-pro-preview", "gemini-3-flash-preview"]
    }
  ],
  "router": {
    "default": "claude-sonnet-4-5"
  }
}
EOF

# Restart router
claude-code-router restart
```

**Test router API:**
```bash
# Test Gemini via router
export ANTHROPIC_BASE_URL=http://localhost:8000
export ANTHROPIC_AUTH_TOKEN=router-managed
claude --model gemini-3-pro-preview "What is 2+2?"
```

**Expected Result:** Response from Gemini via router translation

**Verification:**
- Check router logs
- Verify Google AI API call in console
- Confirm response formatting

## Integration Testing

### Test Agent Spawning with Different Providers

**Test 1: Spawn agent with Anthropic (control)**
```bash
pan work issue PAN-999 --model claude-sonnet-4-5
# Verify: Agent spawns normally
# Verify: No custom env vars set
```

**Test 2: Spawn agent with Kimi (direct)**
```bash
# Configure settings.json with Kimi API key
# Set review_agent to use claude-sonnet-4-5 (will use Kimi endpoint)
pan work issue PAN-998

# Verify in agent state:
# - ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
# - ANTHROPIC_AUTH_TOKEN=sk-kimi-...
# - Agent responds using Kimi's API
```

**Test 3: Spawn agent with GLM (direct)**
```bash
# Configure settings.json with GLM API key
# Set review_agent to use glm-4.7
pan work issue PAN-997

# Verify in agent state:
# - ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
# - ANTHROPIC_AUTH_TOKEN=...
# - API_TIMEOUT_MS=300000
# - Agent responds using GLM
```

**Test 4: Spawn agent with OpenAI (router)**
```bash
# Configure settings.json with OpenAI API key
# Ensure router is running
# Set review_agent to use gpt-4o
pan work issue PAN-996

# Verify in agent state:
# - ANTHROPIC_BASE_URL=http://localhost:8000
# - ANTHROPIC_AUTH_TOKEN=router-managed
# - Router translates API calls
# - Agent responds using GPT-4o
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

**Problem:** Model not found
- Verify model name matches provider's model list
- Check if model is available in your region
- Confirm API tier supports the model

### Router Provider Issues

**Problem:** Router not responding
```bash
# Check if router is running
ps aux | grep claude-code-router

# Restart router
claude-code-router restart

# Check router logs
claude-code-router logs
```

**Problem:** API translation errors
- Check router config.json syntax
- Verify provider API keys in router config
- Review router logs for detailed errors

**Problem:** Model mismatch
- Ensure model name in Panopticon matches router config
- Verify router provider configuration
- Check router model mapping

## Test Checklist

### Direct Provider (Kimi/GLM) Testing
```
[ ] API key configured in settings.json
[ ] Direct Claude Code test successful
[ ] Agent spawning with provider works
[ ] Provider dashboard shows usage
[ ] No router needed/used
[ ] Error handling works (invalid key, etc.)
```

### Router Provider (OpenAI/Gemini) Testing
```
[ ] claude-code-router installed
[ ] Router config.json created
[ ] Router starts successfully
[ ] Direct router test successful
[ ] Agent spawning with router works
[ ] Provider dashboard shows usage
[ ] Router logs show translation
[ ] Error handling works
```

### Integration Testing
```
[ ] Can switch between providers dynamically
[ ] Settings UI shows provider compatibility
[ ] Router only used when needed
[ ] Direct providers have lower latency
[ ] Cost tracking works for all providers
[ ] Fallback to Anthropic works when provider unavailable
```

## Performance Benchmarks

### Latency Comparison (Expected)

| Provider | Type | First Token | Request Time | Notes |
|----------|------|-------------|--------------|-------|
| Anthropic | Direct | ~500ms | ~2s | Baseline |
| Kimi | Direct | ~600ms | ~2.5s | Similar to Anthropic |
| GLM | Direct | ~700ms | ~3s | Slightly slower |
| OpenAI | Router | ~800ms | ~3.5s | +router overhead |
| Gemini | Router | ~900ms | ~4s | +router overhead |

**Note:** Router adds ~200-500ms overhead for API translation

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
