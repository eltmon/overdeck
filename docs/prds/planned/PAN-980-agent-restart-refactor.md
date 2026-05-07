# PAN-980: Agent Restart Refactor — Shared Launch Config, Model Override, Graceful Shutdown

## Vision

Unify the agent launch setup so both fresh starts and restarts share a single code path for provider routing, credential management, and launcher generation. Add a dedicated restart endpoint that supports runtime model overrides and graceful shutdown with continue-file freshness validation.

## Motivation

Currently `spawnAgent()` and `resumeAgent()` independently build provider exports, handle credential-file auth, and generate launcher scripts. When the UI triggers a "restart," it calls `resumeAgent()` which uses the model baked into `agentState.model` — there's no way to override the model at restart time. Additionally, restarts are abrupt with no warning for the agent to save state.

## Design

### Part 1: Shared `buildAgentLaunchConfig()` helper

Extract from `spawnAgent()` and `resumeAgent()` into a single function in `src/lib/agents.ts`:

```typescript
export async function buildAgentLaunchConfig(opts: {
  agentId: string;
  model: string;
  workspace: string;
  agentType: LauncherAgentType;
  resumeSessionId?: string;
  isPlanning?: boolean;
  phase?: string;
}): Promise<{
  launcherContent: string;
  providerEnv: Record<string, string>;
}>
```

This handles:
- `getProviderExportsForModel(model)` — bash export lines for provider auth
- `buildCavemanExports(workspace, config, isPlanning)` — code compression env vars
- `getAgentRuntimeBaseCommand(model)` — resolves `claude` vs `claudish -i` with correct flags
- Credential-file auth setup/teardown (`setupCredentialFileAuth` / `clearCredentialFileAuth`)
- Permission flags assembly

Both `spawnAgent()` and `resumeAgent()` call this instead of duplicating logic.

### Part 2: `POST /api/agents/:id/restart` endpoint

New endpoint in `src/dashboard/server/routes/agents.ts`:

```
POST /api/agents/:id/restart
Body: { model?: string, graceful?: boolean, message?: string }
```

**Graceful mode** (default):
1. Send warning to agent tmux session via load-buffer pattern: "Restarting in 30s. Update .pan/continue.json now with all progress, decisions, hazards, and resume point."
2. Wait 30 seconds
3. Check continue.json mtime — log warning if stale (>5min), but don't block
4. Kill tmux session
5. Call `buildAgentLaunchConfig()` with new model (or existing)
6. Update `agentState.model` if model changed
7. Write new launcher.sh, create tmux session
8. Wait for ready signal, send initial prompt referencing continue file

**Quick mode** (`graceful: false`):
1. Kill tmux session immediately
2. Steps 5-8 from above

### Part 3: Model override in resume

Add optional `model` parameter to `resumeAgent()` signature:
```typescript
export async function resumeAgent(agentId: string, message?: string, opts?: { model?: string })
```

If `opts.model` is provided and differs from `agentState.model`, regenerate launcher with new provider config.

### Part 4: Dashboard UI

- Restart button in SessionView/IssueHeader gets a model selector dropdown
- Models populated from `GET /api/models` (existing endpoint)
- Split button: primary = graceful restart, secondary = force restart
- During graceful countdown: show progress indicator with seconds remaining

## Files to Modify

- `src/lib/agents.ts` — extract `buildAgentLaunchConfig()`, model param on `resumeAgent()`
- `src/dashboard/server/routes/agents.ts` — new restart endpoint
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/` — restart UI

## Acceptance Criteria

- [ ] `buildAgentLaunchConfig()` shared by `spawnAgent()` and `resumeAgent()`
- [ ] `POST /api/agents/:id/restart` with model override verified working
- [ ] Graceful restart sends 30s warning via load-buffer pattern
- [ ] Continue.json freshness check logs warning if stale
- [ ] Quick restart kills and relaunches immediately
- [ ] Dashboard restart button offers model selection
- [ ] `POST /api/agents/:id/resume` unchanged (backwards compat)
- [ ] `POST /api/agents/restart-all` updated to use new shared logic
- [ ] Typecheck + lint + tests pass
