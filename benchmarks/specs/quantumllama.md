# QuantumLlama Provider Specification v1.0

> **This is a synthetic benchmark specification.** QuantumLlama is a fictional AI provider
> used to test Overdeck's agent pipeline. This document serves as the authoritative
> source of truth for benchmark runs — agents should implement exactly what is described
> here without researching external sources.

## Overview

QuantumLlama is a fictional AI model provider that exposes a REST API for text generation.
Overdeck must support QuantumLlama as a first-class provider alongside Anthropic, OpenAI,
and Google — including model routing, cost tracking, and dashboard visibility.

## Provider Details

| Field | Value |
|-------|-------|
| Provider ID | `quantumllama` |
| Display Name | QuantumLlama |
| Base URL | `https://api.quantumllama.ai/v1` |
| Auth Header | `X-QL-Token` |
| Auth Env Var | `QUANTUMLLAMA_API_KEY` |

## Models

| Model ID | Display Name | Context Window | Max Output |
|----------|-------------|----------------|------------|
| `ql-reason-70b` | QL Reason 70B | 200,000 | 16,384 |
| `ql-swift-8b` | QL Swift 8B | 128,000 | 8,192 |
| `ql-nano-1b` | QL Nano 1B | 32,000 | 4,096 |

## Pricing (per 1,000 tokens)

| Model | Input | Output | Cache Read | Cache Write (5m) |
|-------|-------|--------|------------|------------------|
| `ql-reason-70b` | $0.008 | $0.024 | $0.0008 | $0.010 |
| `ql-swift-8b` | $0.002 | $0.006 | $0.0002 | $0.0025 |
| `ql-nano-1b` | $0.0004 | $0.0012 | $0.00004 | $0.0005 |

## API Contract

### Chat Completions

```
POST /v1/chat/completions
```

**Request Headers:**
```
X-QL-Token: <api-key>
Content-Type: application/json
```

**Request Body:**
```json
{
  "model": "ql-reason-70b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": false
}
```

**Response (non-streaming):**
```json
{
  "id": "ql-resp-abc123",
  "model": "ql-reason-70b",
  "created": 1712000000,
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "input_tokens": 24,
    "output_tokens": 8,
    "cache_read_tokens": 0,
    "cache_write_tokens": 24,
    "total_tokens": 32
  }
}
```

**Response (streaming, `"stream": true`):**

Server-Sent Events, each line prefixed with `data: `:
```
data: {"id":"ql-resp-abc123","model":"ql-reason-70b","choices":[{"delta":{"content":"Hello"},"index":0}]}
data: {"id":"ql-resp-abc123","model":"ql-reason-70b","choices":[{"delta":{"content":"!"},"index":0}]}
data: {"id":"ql-resp-abc123","model":"ql-reason-70b","choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"input_tokens":24,"output_tokens":8,"cache_read_tokens":0,"cache_write_tokens":24,"total_tokens":32}}
data: [DONE]
```

### Error Responses

```json
{
  "error": {
    "type": "rate_limit_exceeded",
    "message": "Too many requests. Please retry after 30 seconds.",
    "retry_after": 30
  }
}
```

Error types: `authentication_error`, `rate_limit_exceeded`, `invalid_request`, `model_not_found`, `server_error`.

### Rate Limits

Returned in response headers:
```
X-QL-RateLimit-Remaining: 58
X-QL-RateLimit-Reset: 1712000060
```

## Integration Requirements

The following must be implemented in Overdeck to support QuantumLlama:

### 1. Provider Configuration

Add QuantumLlama to the provider registry so it can be selected in `config.yaml`:

```yaml
models:
  work: ql-reason-70b
  review: ql-swift-8b
  test: ql-nano-1b
```

The API key should be read from `QUANTUMLLAMA_API_KEY` environment variable
(loaded from `~/.overdeck.env`).

### 2. Cost Tracking

Add pricing entries to the cost calculation module so that token usage from
QuantumLlama models is correctly costed. The pricing table above is the
source of truth. Map the API response `usage` fields to Overdeck's
standard token categories:

| QuantumLlama field | Overdeck field |
|---|---|
| `input_tokens` | `inputTokens` |
| `output_tokens` | `outputTokens` |
| `cache_read_tokens` | `cacheReadTokens` |
| `cache_write_tokens` | `cacheWriteTokens` |

### 3. Model Routing

The Cloister must be able to route agent sessions to QuantumLlama models.
This means:

- Model IDs starting with `ql-` must be recognized as QuantumLlama models
- The provider must be resolvable from the model ID (e.g., `ql-reason-70b` → `quantumllama`)
- Model capabilities (context window, max output) must be available for routing decisions

### 4. Dashboard Visibility

QuantumLlama models must appear in:
- Cost breakdowns (by-model view) with correct friendly names
- Model selection dropdowns (if any exist)
- Agent info display showing which model is in use

### 5. CLI Visibility

`pan status` and cost-related CLI commands must display QuantumLlama
models and costs the same as any other provider.

## What NOT to Implement

- **Do NOT implement actual API calls** to QuantumLlama (it doesn't exist)
- **Do NOT create HTTP client code** for the provider
- **Do NOT modify agent spawning** to actually use QuantumLlama models
- The focus is on the configuration, routing, cost tracking, and display layers
