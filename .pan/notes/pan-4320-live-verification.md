# Live verification (PAN-4320)

Peer dashboard: `API_PORT=3497 OVERDECK_DISABLE_DEACON=1 node dist/dashboard/server.js`, started
from this workspace after `npm run build`. Primary `:3011` dashboard was never touched or
restarted. Peer stopped by recorded PID after the checks below; confirmed `:3497` free
afterward.

## 1. `/ws/rpc` probe — every live managed pane served `running`

```
agent-pan-3684-review done → served running
agent-pan-3684 done → served running
agent-pan-4290-review idle → served running
agent-pan-4290 done → served running
agent-pan-4291-review working → served running
agent-pan-4291 done → served running
agent-pan-1166-review idle → served running
agent-pan-1166 done → served running
agent-pan-2609 done → served running
agent-pan-4311 idle → served running
agent-pan-4312-review idle → served running
agent-pan-4312 working → served running
agent-pan-4320 working → served running
```

No agent printed `MISSING` or `stopped`.

## 2. `GET /api/agents` — the real FR-2 regression check

85 total rows; 72 `stopped`, 13 `healthy`. All 13 `healthy` rows have `hasLivePane: true` and
their ids are exactly the 13 agent ids from the `/ws/rpc` probe above (`agent-pan-3684{,-review}`,
`agent-pan-4290{,-review}`, `agent-pan-4291{,-review}`, `agent-pan-1166{,-review}`,
`agent-pan-2609`, `agent-pan-4311`, `agent-pan-4312{,-review}`, `agent-pan-4320`). On unfixed
code (join by `terminalId ?? id`) every row served `stopped` — this is the check that would have
caught the original bug.

## 3. `herdr agent list`

13 panes with an `agentId` token matching `^(agent|planning|strike)-`, and no more — the same 13
ids as above (verified by diffing the id sets; the full raw JSON is reproducible via `herdr agent
list` and is omitted here for length). Confirms the dashboard's `agentsById`/`hasLivePane` answer
matches the Herdr backend's own live-agent inventory 1:1.

## Deviation: God View shelf/Doldrums screenshot check skipped

The PRD's optional "Also check" (God View shelf/Doldrums placement via an isolated Playwright
browser profile against the peer dashboard) was not run in this session — no isolated
Chrome/Playwright profile was readily available, and the peer dashboard had already been stopped
by the time this was considered. The FR-2/FR-3 regression checks above (the actual acceptance
criteria) are covered by the WI-2/WI-3 unit tests and the two live checks above. If PAN-4301-style
God View misplacement is later observed on Herdr, file a follow-up issue rather than folding it
into this one, per the PRD's own non-goal note.
