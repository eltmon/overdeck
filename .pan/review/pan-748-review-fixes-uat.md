# PAN-748 Review Fixes UAT

Date: 2026-05-23
Server: `PANOPTICON_DISABLE_DEACON=1 API_PORT=4317 PORT=4317 HOST=127.0.0.1 /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js`
URL: `http://localhost:4317/`

## Automated gates

- `npm --prefix src/dashboard/frontend test -- src/components/chat/__tests__/ContextUsageIndicator.test.tsx` passed: 1 file, 12 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

## REST contextUsage evidence

Manual request against the built dashboard:

```bash
curl -sf http://127.0.0.1:4317/api/conversations?limit=1 >/tmp/pan-748-conversations.json
node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync('/tmp/pan-748-conversations.json','utf8')); const first=Array.isArray(data)?data[0]:data; const usage=first?.contextUsage; console.log(JSON.stringify({count:Array.isArray(data)?data.length:null, hasContextUsage:Object.prototype.hasOwnProperty.call(first ?? {}, 'contextUsage'), contextUsage: usage && {activeBytes: typeof usage.activeBytes, estimatedTokens: typeof usage.estimatedTokens, contextWindow: typeof usage.contextWindow, percentUsed: typeof usage.percentUsed}}, null, 2));"
```

Observed output:

```json
{
  "count": 1,
  "hasContextUsage": true,
  "contextUsage": {
    "activeBytes": "number",
    "estimatedTokens": "number",
    "contextWindow": "number",
    "percentUsed": "number"
  }
}
```

## Browser smoke evidence

Using Playwright against the built Node 22 dashboard:

- Opened `http://localhost:4317/`, then clicked Command Deck.
- The selected conversation page rendered a `[data-testid="context-usage-indicator"]` with title `884,044 active tokens (100%) of 200,000 context window` and `data-tone="high"`.
- Wide header: indicator showed token size, percent text, progress bar, and window text; dot was hidden.
- Medium header at 670px: size and bar were visible; percent and window text were hidden; dot was hidden.
- Small header at 320px: only the dot was visible; size, percent, bar, and window text were hidden.
