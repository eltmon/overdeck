# Hume EVI Voice Management

Manage Hume AI Empathic Voice Interface (EVI) configs for MYN's Kaia voice assistant.

## When to Use

- Debugging voice connection failures (config_not_found, auth errors, WebSocket drops)
- Creating/listing/deleting EVI configs
- Checking which config ID production or a workspace is using
- Verifying BYOLLM URL settings on a config

## Authentication

**REST API**: Use `X-Hume-Api-Key` header for listing configs.
**Individual config GET/DELETE**: Requires OAuth2 Bearer token.
**WebSocket**: Pass `access_token` as query parameter.

### Get credentials

```bash
source ~/.myn/.env
# HUME_API_KEY and HUME_SECRET_KEY are both in ~/.myn/.env
```

### Get OAuth2 Bearer token (when X-Hume-Api-Key alone returns 401)

```bash
source ~/.myn/.env
HUME_TOKEN=$(curl -s -X POST "https://api.hume.ai/oauth2-cc/token" \
  -d "grant_type=client_credentials" \
  -u "${HUME_API_KEY}:${HUME_SECRET_KEY}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

## API Quick Reference

### List all EVI configs

```bash
source ~/.myn/.env
curl -s "https://api.hume.ai/v0/evi/configs?page_size=100&restrict_to_most_recent=true" \
  -H "X-Hume-Api-Key: ${HUME_API_KEY}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data['configs_page']:
    lm = c.get('language_model', {})
    print(f\"  {c['id']}  v{c['version']}  {c['name']}  byollm={lm.get('model_resource','N/A')}\")
"
```

### Get a specific config (needs OAuth2)

```bash
curl -s "https://api.hume.ai/v0/evi/configs/${CONFIG_ID}" \
  -H "X-Hume-Api-Key: ${HUME_API_KEY}" \
  -H "Authorization: Bearer ${HUME_TOKEN}"
```

### Create a new config

```bash
curl -s -X POST "https://api.hume.ai/v0/evi/configs" \
  -H "X-Hume-Api-Key: ${HUME_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "evi_version": "3",
    "name": "kaia-my-config",
    "voice": { "provider": "CUSTOM_VOICE", "id": "751a7f58-7b48-490c-884f-7a7eece04278" },
    "language_model": {
      "model_provider": "CUSTOM_LANGUAGE_MODEL",
      "model_resource": "https://api.mindyournow.com/api/v1/ai/hume/chat/completions"
    },
    "ellm_model": { "allow_short_responses": false }
  }'
```

### Delete a config

```bash
curl -s -X DELETE "https://api.hume.ai/v0/evi/configs/${CONFIG_ID}" \
  -H "X-Hume-Api-Key: ${HUME_API_KEY}"
```

### Test WebSocket connection (from browser console or Playwright)

```javascript
// Fetch tokens from MYN backend
const resp = await fetch('https://api.mindyournow.com/api/v1/tts/hume/token', {
  headers: { 'Authorization': `Bearer ${JWT_TOKEN}` }
});
const { accessToken, sessionSecret } = await resp.json();

// Connect to Hume EVI
const ws = new WebSocket(`wss://api.hume.ai/v0/evi/chat?access_token=${accessToken}&config_id=${CONFIG_ID}`);
ws.onopen = () => ws.send(JSON.stringify({ type: 'session_settings', language_model_api_key: sessionSecret }));
ws.onmessage = (e) => console.log('MSG:', JSON.parse(e.data));
ws.onclose = (e) => console.log('CLOSE:', e.code, e.reason);
```

## Key Config IDs

| Config | ID | Purpose |
|--------|-----|---------|
| **kaia-default-poc** | `aff795b7-b430-4200-9cb2-bcde50256378` | Production template, BYOLLM → api.mindyournow.com |
| **Kaia_v1 voice** | `751a7f58-7b48-490c-884f-7a7eece04278` | Custom voice design (confident female life coach) |

## Production Config

- **Env var**: `VITE_HUME_CONFIG_ID` (set in Vercel env vars)
- **Fallback**: Hardcoded in `src/components/voice/VoiceMode.tsx` as `aff795b7-b430-4200-9cb2-bcde50256378`
- **BYOLLM URL**: `https://api.mindyournow.com/api/v1/ai/hume/chat/completions`

## Workspace Configs

Panopticon auto-creates per-workspace configs via `projects.yaml`:

```yaml
hume:
  template_config_id: "aff795b7-b430-4200-9cb2-bcde50256378"
  name_pattern: "kaia-{{FEATURE_FOLDER}}"
  byollm_url_pattern: "https://api-{{FEATURE_FOLDER}}.mindyournow.com/api/v1/ai/hume/chat/completions"
```

Config ID stored in workspace `.hume-config` file, loaded as `VITE_HUME_CONFIG_ID`.

## Common Issues

### E0709 config_not_found
The config ID doesn't exist. Check if it was deleted (workspace cleanup). List configs to find the correct one.

### Credentials are required / 401
- For list endpoint: Use `X-Hume-Api-Key` header (NOT Authorization Bearer)
- For individual config: Need BOTH `X-Hume-Api-Key` AND `Authorization: Bearer <oauth_token>`
- OAuth2 token endpoint returns `Content-Type: application/octet-stream` (not JSON) — parse as raw string

### WebSocket connects then immediately disconnects
1. Check config ID exists (`E0709` = config deleted)
2. Check BYOLLM URL in config points to correct backend
3. Check session secret is valid (stored in Redis with 35-min TTL)
4. Check backend BYOLLM endpoint is reachable and not returning 4xx/5xx

### Voice session ends immediately in production
1. Check `VITE_HUME_CONFIG_ID` in Vercel env vars
2. Verify with: list configs API → find production config → compare IDs
3. If stale, update Vercel env var or rely on hardcoded fallback in VoiceMode.tsx

## Architecture

```
User taps Voice → Frontend fetches /api/v1/tts/hume/token
  → Backend: OAuth2 to Hume (HUME_API_KEY:HUME_SECRET_KEY) → accessToken
  → Backend: Generate sessionSecret (256-bit, stored in Redis 35min)
  → Frontend receives { accessToken, sessionSecret }

Frontend: VoiceProvider.connect({ auth: accessToken, configId, sessionSettings: { languageModelApiKey: sessionSecret } })
  → WebSocket to wss://api.hume.ai/v0/evi/chat
  → Hume sends user speech → BYOLLM POST to MYN backend with Bearer sessionSecret
  → Backend validates secret via Redis, runs Spring AI pipeline, streams response
  → Hume converts response to speech via Octave TTS
```

## Key Files

- **Frontend**: `src/components/voice/VoiceMode.tsx` — VoiceProvider lifecycle
- **Frontend**: `src/hooks/useHumeVoice.ts` — Token management
- **Frontend**: `src/atoms/voiceModeAtoms.ts` — Voice UI state (Jotai, NOT ChatContext)
- **Backend**: `HumeTokenController.java` — Token endpoint
- **Backend**: `HumeByollmController.java` — BYOLLM proxy
- **Backend**: `HumeSessionSecretService.java` — Redis session secrets
- **Backend**: `HumeEmotionService.java` — 48-emotion prosody analysis
- **Panopticon**: `src/lib/hume.ts` — Workspace config CRUD
- **Docs**: `myn/docs/technical/ai/HUME-EVI-INTEGRATION.md` — Full reference
