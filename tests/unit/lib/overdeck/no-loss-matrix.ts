/**
 * G3 No-Loss Matrix — remodel-wide surface inventory.
 *
 * Every HTTP endpoint, WebSocket RPC method, and `pan` CLI verb that existed
 * in the legacy server receives a disposition here before the overdeck data
 * remodel is declared surface-locked.
 *
 * Dispositions:
 *   READ        — served by a domain Resolver (read door)
 *   WRITE       — served by a domain Writer  (write door)
 *   AGGREGATE   — cross-domain recompose; no single door owns it
 *   RELOCATE    — belongs to a different domain / service not yet built
 *   DELETE      — intentionally dropped; door = reason string
 *   OUT_OF_SCOPE — outside the 8 remodel domains; preserved as-is; door = note
 */
export type Disposition =
  | 'READ'
  | 'WRITE'
  | 'AGGREGATE'
  | 'RELOCATE'
  | 'DELETE'
  | 'OUT_OF_SCOPE';

export interface MatrixEntry {
  /** Human-readable identifier: "METHOD /path", "pan.rpcMethod", or "pan <verb>" */
  surface: string;
  kind: 'http' | 'rpc' | 'cli';
  disposition: Disposition;
  /**
   * For READ/WRITE/AGGREGATE/RELOCATE: name of owning door / target service.
   * For DELETE / OUT_OF_SCOPE: reason / note string (must be non-empty).
   */
  door: string;
}

export const NO_LOSS_MATRIX: MatrixEntry[] = [

  // ── updater.ts ────────────────────────────────────────────────────────────
  { surface: 'GET /api/update/status',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Updater service; preserves and extends the existing version surface' },
  { surface: 'POST /api/update/check',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Updater service; explicit fresh release discovery' },
  { surface: 'POST /api/update/install',                      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Updater service; exact-version npm installation' },

  // ── restart-gate.ts (PAN-3729/PAN-3731) ───────────────────────────────────
  { surface: 'POST /api/restart-gate/requests',               kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'RestartGate service; upsert + poll + TTL refresh, outside 8 remodel domains' },
  { surface: 'POST /api/restart-gate/claim',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'RestartGate service; exclusive right to restart, outside 8 remodel domains' },
  { surface: 'POST /api/restart-gate/approve',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'RestartGate service; operator approval, outside 8 remodel domains' },
  { surface: 'GET /api/restart-gate',                         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'RestartGate service; read door for the current gate, outside 8 remodel domains' },

  // ── admin.ts ──────────────────────────────────────────────────────────────
  { surface: 'GET /api/admin/tldr/:issueId',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR admin helper; outside 8 remodel domains' },
  { surface: 'POST /api/admin/conversations/backfill-titles',    kind: 'http', disposition: 'WRITE',      door: 'ConversationWriter.retitle (deterministic backfill)' },

  // ── artifacts.ts (actual paths from codebase) ─────────────────────────────
  { surface: 'GET /a/:slug',                              kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts short-URL redirect; outside 8 remodel domains' },
  { surface: 'GET /api/artifacts/:slug',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'GET /api/workspaces/:issueId/artifacts',    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'GET /api/artifacts/:slug/thumbnail',        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'POST /api/artifacts/:slug/unshare',         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },

  // ── agents.ts ─────────────────────────────────────────────────────────────
  { surface: 'GET /api/agents',                                          kind: 'http', disposition: 'READ',       door: 'AgentsResolver.list(filter)' },
  { surface: 'GET /api/agents/:id/output',                               kind: 'http', disposition: 'RELOCATE',   door: 'Transcripts' },
  { surface: 'GET /api/agents/:id/conversation',                         kind: 'http', disposition: 'RELOCATE',   door: 'Transcripts' },
  { surface: 'GET /api/agents/:id/health-history',                       kind: 'http', disposition: 'READ',       door: 'AgentsResolver.getHealthHistory' },
  { surface: 'POST /api/agents/:id/poke',                                kind: 'http', disposition: 'RELOCATE',   door: 'DeliveryService.poke' },
  { surface: 'GET /api/agents/:id/pending-questions',                    kind: 'http', disposition: 'RELOCATE',   door: 'Q&A (AskUserQuestion)' },
  { surface: 'POST /api/agents/:id/answer-question',                     kind: 'http', disposition: 'RELOCATE',   door: 'Q&A (AskUserQuestion)' },
  { surface: 'POST /api/agents/:id/heartbeat',                           kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.recordHealth' },
  { surface: 'POST /api/agents/:id/work-complete',                       kind: 'http', disposition: 'RELOCATE',   door: 'IssueWriter.advance("in_review")' },
  { surface: 'POST /api/agents/:id/stuck',                               kind: 'http', disposition: 'RELOCATE',   door: 'Orchestration' },
  { surface: 'POST /api/agents/:id/classify-completion',                 kind: 'http', disposition: 'RELOCATE',   door: 'Orchestration' },
  { surface: 'POST /api/internal/agents/:id/permissions/request',        kind: 'http', disposition: 'RELOCATE',   door: 'AgentPermissionsWriter.request' },
  { surface: 'POST /api/agents/:id/permissions/:requestId/respond',      kind: 'http', disposition: 'RELOCATE',   door: 'AgentPermissionsWriter.resolve' },
  { surface: 'GET /api/agents/:id/runtime',                              kind: 'http', disposition: 'READ',       door: 'AgentsResolver.getRuntime' },
  { surface: 'GET /api/agents/:id/git-info',                             kind: 'http', disposition: 'RELOCATE',   door: 'Workspace/git' },
  { surface: 'GET /api/agents/:id/activity',                             kind: 'http', disposition: 'RELOCATE',   door: 'Transcripts/runtime' },
  { surface: 'GET /api/agents/:id/files',                                kind: 'http', disposition: 'RELOCATE',   door: 'Workspace' },
  { surface: 'GET /api/agents/:id/timeline',                             kind: 'http', disposition: 'RELOCATE',   door: 'Observability/events' },
  { surface: 'POST /api/agents/:id/suspend',                             kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.stop(id,{suspend:true})' },
  { surface: 'POST /api/agents/:id/pause',                               kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.pause' },
  { surface: 'POST /api/agents/:id/unpause',                             kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.unpause' },
  { surface: 'POST /api/agents/:id/untroubled',                          kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.clearTroubled' },
  { surface: 'POST /api/agents/:id/resume',                              kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.resume' },
  { surface: 'POST /api/agents/:id/recover',                             kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.resume (orphan path)' },
  { surface: 'POST /api/agents/:id/restart',                             kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.stop then resume' },
  { surface: 'GET /api/agents/:id/cloister-health',                      kind: 'http', disposition: 'READ',       door: 'AgentsResolver.getHealthHistory (duplicate door)' },
  { surface: 'GET /api/agents/:agentId/diffs',                           kind: 'http', disposition: 'RELOCATE',   door: 'Diffs domain' },
  { surface: 'GET /api/agents/:agentId/diffs/:turnId',                   kind: 'http', disposition: 'RELOCATE',   door: 'Diffs domain' },
  { surface: 'GET /api/agents/:agentId/diffs/full',                      kind: 'http', disposition: 'RELOCATE',   door: 'Diffs domain' },
  { surface: 'GET /api/agents/:agentId/diffs/vs-main',                   kind: 'http', disposition: 'RELOCATE',   door: 'Diffs domain' },
  { surface: 'POST /api/agents/:agentId/diffs/test-checkpoint',          kind: 'http', disposition: 'RELOCATE',   door: 'Diffs domain' },
  { surface: 'GET /api/agents/:id/handoff/suggestion',                   kind: 'http', disposition: 'RELOCATE',   door: 'Conversations' },
  { surface: 'POST /api/agents/:id/handoff',                             kind: 'http', disposition: 'RELOCATE',   door: 'Conversations' },
  { surface: 'GET /api/agents/:id/cost',                                 kind: 'http', disposition: 'RELOCATE',   door: 'CostResolver.byAgent' },
  { surface: 'POST /api/agents',                                         kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.spawn' },
  { surface: 'GET /api/agents/:id/tmux-alive',                           kind: 'http', disposition: 'READ',       door: 'AgentsResolver.isAlive' },
  { surface: 'POST /api/agents/restart-all',                             kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.resume ×N' },
  { surface: 'GET /api/agents/:id/has-session',                          kind: 'http', disposition: 'READ',       door: 'AgentsResolver.isAlive (duplicate)' },
  { surface: 'POST /api/agents/:id/reset-session',                       kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.switchModel (session-clear)' },
  { surface: 'POST /api/agents/:id/delivery-method',                     kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.setDeliveryMethod' },
  { surface: 'POST /api/agents/:id/switch-model',                        kind: 'http', disposition: 'DELETE',     door: 'Agent model locked after spawn; route preserved as 409 compatibility rejection' },
  { surface: 'DELETE /api/agents/:id',                                   kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.stop (DELETE alias)' },
  { surface: 'POST /api/agents/:id/stop',                                kind: 'http', disposition: 'WRITE',      door: 'AgentWriter.stop' },
  { surface: 'POST /api/agents/:id/message',                             kind: 'http', disposition: 'RELOCATE',   door: 'DeliveryService.tell' },
  { surface: 'POST /api/agents/:id/tell',                                kind: 'http', disposition: 'RELOCATE',   door: 'DeliveryService.tell' },

  // ── artifacts.ts ──────────────────────────────────────────────────────────
  { surface: 'GET /api/artifacts',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'GET /api/artifacts/:id',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'POST /api/artifacts',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'DELETE /api/artifacts/:id',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },
  { surface: 'GET /api/artifacts/:id/download',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Artifacts service; outside 8 remodel domains' },

  // ── autopreso.ts ──────────────────────────────────────────────────────────
  { surface: 'POST /api/autopreso/start',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'AutoPreso; outside 8 remodel domains' },
  { surface: 'POST /api/autopreso/back-to-staging',       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'AutoPreso; outside 8 remodel domains' },
  { surface: 'POST /api/autopreso/session/reset',         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'AutoPreso; outside 8 remodel domains' },

  // ── cliproxy.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/cliproxy/status',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'CLIProxy status probe; outside 8 remodel domains' },
  { surface: 'POST /api/cliproxy/restart',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'CLIProxy restart; outside 8 remodel domains' },

  // ── cloister.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/cloister/status',                  kind: 'http', disposition: 'AGGREGATE',   door: 'CloisterRuntime.getStatus recomposed' },
  { surface: 'POST /api/cloister/start',                  kind: 'http', disposition: 'RELOCATE',    door: 'CloisterRuntime.start (residue)' },
  { surface: 'POST /api/cloister/stop',                   kind: 'http', disposition: 'RELOCATE',    door: 'CloisterRuntime.stop (residue)' },
  { surface: 'POST /api/cloister/emergency-stop',         kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.emergencyStop → AgentWriter.stop ×N' },
  { surface: 'POST /api/cloister/brake',                  kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.brake → AgentWriter.stop ×N' },
  { surface: 'POST /api/cloister/resume-spawns',          kind: 'http', disposition: 'RELOCATE',    door: 'CloisterRuntime.resumeSpawns (residue)' },
  { surface: 'GET /api/cloister/spawn-status',            kind: 'http', disposition: 'RELOCATE',    door: 'CloisterRuntime.isSpawnPaused (residue)' },
  { surface: 'GET /api/cloister/config',                  kind: 'http', disposition: 'READ',        door: 'FILE-CONFIG cloister.toml' },
  { surface: 'PUT /api/cloister/config',                  kind: 'http', disposition: 'WRITE',       door: 'FILE-CONFIG cloister.toml' },
  { surface: 'GET /api/cloister/agents/health',           kind: 'http', disposition: 'RELOCATE',    door: 'AgentsResolver.getHealthHistory ×N' },
  { surface: 'GET /api/boot-reconciliation',              kind: 'http', disposition: 'AGGREGATE',   door: 'BootReconciliationRuntime.getState + AgentsResolver.list' },
  { surface: 'POST /api/boot-reconciliation/decision',    kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.bootReconciliationDecision + CloisterRuntime.apply' },
  { surface: 'POST /api/boot-reconciliation/extend',      kind: 'http', disposition: 'WRITE',       door: 'BootReconciliationRuntime.extendGrace → SettingsWriter.bootReconciliationGrace' },

  // ── codex-auth.ts ─────────────────────────────────────────────────────────
  { surface: 'GET /api/settings/codex-auth',              kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'POST /api/settings/codex-reauth',           kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'POST /api/settings/codex-reauth/status',    kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },

  // ── commands.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/commands',                                      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Composer command catalog from generated module state; no canonical state store' },

  // ── linear-mcp-auth.ts (PAN-2997) ─────────────────────────────────────────
  { surface: 'GET /api/linear-mcp-auth',                  kind: 'http', disposition: 'READ',        door: 'linear-mcp-auth event fold (resolveLinearMcpAuthIntervention)' },
  { surface: 'POST /api/linear-mcp-auth/callback',        kind: 'http', disposition: 'WRITE',       door: 'linear-mcp-auth events + messageAgent delivery door' },
  { surface: 'POST /api/linear-mcp-auth/complete',        kind: 'http', disposition: 'WRITE',       door: 'linear-mcp-auth events (appendLinearMcpAuthHealthyEvent)' },

  // ── command-deck.ts ───────────────────────────────────────────────────────
  { surface: 'GET /api/command-deck/activity/:issueId',                  kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + events' },
  { surface: 'GET /api/command-deck/planning/:issueId',                  kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents planning detail' },
  { surface: 'POST /api/command-deck/planning/:issueId/status-review',   kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance' },
  { surface: 'POST /api/command-deck/planning/:issueId/upload',          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Planning file upload; outside 8 remodel domains' },
  { surface: 'POST /api/command-deck/planning/:issueId/sync-discussions', kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Tracker sync helper; outside 8 remodel domains' },
  { surface: 'POST /api/command-deck/planning/:issueId/init',            kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("planning") + AgentWriter.spawn' },
  { surface: 'GET /api/command-deck/projects',                           kind: 'http', disposition: 'READ',        door: 'ConfigResolver.listProjects' },

  // ── context.ts ────────────────────────────────────────────────────────────
  { surface: 'GET /api/context/layers',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Context layers service; outside 8 remodel domains' },
  { surface: 'POST /api/context/sync',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Context layers service; outside 8 remodel domains' },
  { surface: 'POST /api/context/preview',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Context layers service; outside 8 remodel domains' },
  { surface: 'PUT /api/context/layers',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Context layers service; outside 8 remodel domains' },

  // ── conversations.ts ──────────────────────────────────────────────────────
  { surface: 'GET /api/conversations',                                   kind: 'http', disposition: 'AGGREGATE',   door: 'ConversationsResolver.list + TranscriptsResolver.facts' },
  { surface: 'GET /api/conversations/pending-input',                     kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.pendingInput' },
  { surface: 'GET /api/conversations/archived',                          kind: 'http', disposition: 'READ',        door: 'ConversationsResolver.list({archived:true})' },
  { surface: 'GET /api/conversations/:id',                               kind: 'http', disposition: 'READ',        door: 'ConversationsResolver.get' },
  { surface: 'GET /api/conversations/:name/handoff-doc',                 kind: 'http', disposition: 'READ',        door: 'ConversationsResolver.getHandoffDoc' },
  { surface: 'POST /api/conversations',                                  kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.create + ConversationRuntime.spawn' },
  { surface: 'POST /api/conversations/:name/stop',                       kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.stop' },
  { surface: 'POST /api/conversations/:name/resume',                     kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.resume' },
  { surface: 'POST /api/conversations/:name/switch-model',               kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.setHarness/setModel before first session only' },
  { surface: 'GET /api/conversations/:name/messages',                    kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.parse' },
  { surface: 'GET /api/conversations/:name/message-locator',             kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.resolveFile' },
  { surface: 'POST /api/conversations/:name/upload-image',               kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.stageAttachment' },
  { surface: 'POST /api/conversations/:name/delete-image',               kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.removeAttachment' },
  { surface: 'POST /api/conversations/:name/message',                    kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.deliver' },
  { surface: 'POST /api/conversations/:id/codex-approval',               kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.approve' },
  { surface: 'POST /api/conversations/:id/pane-choice',                  kind: 'http', disposition: 'RELOCATE',    door: 'handleConversationPaneChoiceAnswer (lib/overdeck/conversation-pane-choice)' },
  { surface: 'POST /api/conversations/:name/delivery-method',            kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.setDeliveryMethod' },
  { surface: 'POST /api/conversations/:name/thinking-level',             kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.setEffort + ConversationRuntime.controlChannel' },
  { surface: 'POST /api/conversations/:name/compact',                    kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.controlChannel.compact' },
  { surface: 'POST /api/conversations/:name/abort',                      kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.piAbortKey (Escape; no durable state)' },
  { surface: 'POST /api/conversations/:name/control-ack',                kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.controlAckRegistry (ephemeral ack)' },
  { surface: 'PATCH /api/conversations/:name',                           kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.retitle' },
  { surface: 'PATCH /api/conversations/:name/move',                      kind: 'http', disposition: 'WRITE',       door: 'setConversationProjectKey (lib/overdeck/conversations.js, PAN-1577)' },
  { surface: 'DELETE /api/conversations/:name',                          kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.archive (idempotent alias)' },
  { surface: 'POST /api/conversations/:name/archive',                    kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.archive' },
  { surface: 'POST /api/conversations/:name/unarchive',                  kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.unarchive' },
  { surface: 'POST /api/conversations/:name/clear-fork-state',           kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.clearForkState' },
  { surface: 'POST /api/conversations/restart-all',                      kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.restart fan-out' },
  { surface: 'POST /api/conversations/:name/favorite',                   kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.setFavorite' },
  { surface: 'DELETE /api/conversations/:name/favorite',                 kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.unsetFavorite' },
  { surface: 'POST /api/conversations/:name/summary-fork',               kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.forkNewFile + RELOCATE spawn' },
  { surface: 'POST /api/conversations/:name/plan-action',                kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.planAction' },
  { surface: 'GET /api/conversations/:name/diffs',                       kind: 'http', disposition: 'RELOCATE',    door: 'Diffs' },
  { surface: 'GET /api/conversations/:name/diffs/full',                  kind: 'http', disposition: 'RELOCATE',    door: 'Diffs' },
  { surface: 'GET /api/conversations/:name/diffs/:turnId',               kind: 'http', disposition: 'RELOCATE',    door: 'Diffs' },
  { surface: 'POST /api/conversations/:name/retitle',                    kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.retitle' },
  { surface: 'GET /api/conversations/:name/about',                       kind: 'http', disposition: 'AGGREGATE',   door: 'metadata + TranscriptsResolver.facts' },

  // ── costs.ts ──────────────────────────────────────────────────────────────
  { surface: 'GET /api/costs/summary',                    kind: 'http', disposition: 'READ',        door: 'CostResolver.summary' },
  { surface: 'GET /api/costs/by-issue',                   kind: 'http', disposition: 'READ',        door: 'CostResolver.byIssue' },
  { surface: 'POST /api/costs/rebuild',                   kind: 'http', disposition: 'WRITE',       door: 'CostWriter.rebuild' },
  { surface: 'POST /api/costs/deduplicate',               kind: 'http', disposition: 'DELETE',      door: 'structural dedup now automatic on ingest via UNIQUE index; manual verb removed' },
  { surface: 'GET /api/costs/stream',                     kind: 'http', disposition: 'READ',        door: 'CostResolver.recent + RPC live sub' },
  { surface: 'GET /api/costs/trends',                     kind: 'http', disposition: 'READ',        door: 'CostResolver.byDay' },
  { surface: 'GET /api/costs/by-model',                   kind: 'http', disposition: 'READ',        door: 'CostResolver.byModel' },
  { surface: 'GET /api/costs/issue/:id',                  kind: 'http', disposition: 'READ',        door: 'CostResolver.issueDetail' },
  { surface: 'GET /api/costs/by-agent',                   kind: 'http', disposition: 'READ',        door: 'CostResolver.byAgent' },
  { surface: 'POST /api/costs/sync-wal',                  kind: 'http', disposition: 'WRITE',       door: 'CostWriter.reconcile({source:"wal"})' },
  { surface: 'POST /api/costs/reconcile',                 kind: 'http', disposition: 'WRITE',       door: 'CostWriter.reconcile' },
  { surface: 'GET /api/costs/experiments',                kind: 'http', disposition: 'DELETE',      door: 'dead caveman A/B experiment PAN-611; column dropped from locked schema' },
  { surface: 'GET /api/costs/background',                 kind: 'http', disposition: 'READ',        door: 'CostResolver.byBackgroundSource' },

  // ── diffs.ts ──────────────────────────────────────────────────────────────
  { surface: 'GET /api/diffs/:sessionName',               kind: 'http', disposition: 'RELOCATE',    door: 'Diffs domain' },
  { surface: 'GET /api/diffs/:sessionName/full',          kind: 'http', disposition: 'RELOCATE',    door: 'Diffs domain' },
  { surface: 'GET /api/diffs/:sessionName/:turnId',       kind: 'http', disposition: 'RELOCATE',    door: 'Diffs domain' },
  { surface: 'POST /api/diffs/:sessionName/refresh',      kind: 'http', disposition: 'RELOCATE',    door: 'Diffs domain' },
  { surface: 'GET /api/diffs/:sessionName/status',        kind: 'http', disposition: 'RELOCATE',    door: 'Diffs domain' },

  // ── discovered-sessions.ts ────────────────────────────────────────────────
  { surface: 'GET /api/discovered-sessions/stats',        kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.stats' },
  { surface: 'GET /api/discovered-sessions',              kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.list' },
  { surface: 'GET /api/discovered-sessions/search',       kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.search' },
  { surface: 'GET /api/discovered-sessions/cost',         kind: 'http', disposition: 'RELOCATE',    door: 'Cost' },
  { surface: 'GET /api/discovered-sessions/:id',          kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.get' },
  { surface: 'GET /api/discovered-sessions/:id/messages', kind: 'http', disposition: 'READ',        door: 'TranscriptsResolver.messagesForDiscoveredSession' },
  { surface: 'POST /api/discovered-sessions/:id/enrich',  kind: 'http', disposition: 'WRITE',       door: 'TranscriptsWriter.enrich(id)' },
  { surface: 'POST /api/discovered-sessions/scan',        kind: 'http', disposition: 'WRITE',       door: 'TranscriptsWriter.scan (rebuild)' },
  { surface: 'POST /api/discovered-sessions/enrich',      kind: 'http', disposition: 'WRITE',       door: 'TranscriptsWriter.enrich' },
  { surface: 'POST /api/discovered-sessions/embed',       kind: 'http', disposition: 'WRITE',       door: 'TranscriptsWriter.embed' },
  { surface: 'GET /api/discovered-sessions/config',       kind: 'http', disposition: 'RELOCATE',    door: 'Settings' },
  { surface: 'PUT /api/discovered-sessions/config',       kind: 'http', disposition: 'RELOCATE',    door: 'Settings' },
  { surface: 'POST /api/discovered-sessions/test-connection', kind: 'http', disposition: 'RELOCATE', door: 'Settings' },

  // ── events.ts ─────────────────────────────────────────────────────────────
  { surface: 'GET /events/stream',                        kind: 'http', disposition: 'RELOCATE',    door: 'Observability.subscribeDomainEvents (legacy SSE; replaced by RPC stream)' },
  { surface: 'GET /events/version',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Build-version probe; outside 8 remodel domains' },

  // ── internal-events.ts ────────────────────────────────────────────────────
  { surface: 'POST /api/internal/events',                 kind: 'http', disposition: 'WRITE',       door: 'DomainEventWriter.append (internal deacon bridge)' },
  { surface: 'POST /api/internal/events/append-once',     kind: 'http', disposition: 'WRITE',       door: 'DomainEventWriter.appendOnce (internal deacon bridge; settled at-most-once append, PAN-3092)' },
  { surface: 'GET /api/internal/events/latest',           kind: 'http', disposition: 'READ',        door: 'DomainEventResolver.latestSequence (internal deacon bridge)' },
  { surface: 'GET /api/internal/events/stream',           kind: 'http', disposition: 'READ',        door: 'DomainEventResolver.stream (internal deacon bridge)' },

  // ── feature-registry.ts ───────────────────────────────────────────────────
  { surface: 'GET /api/registry/features',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Feature registry; outside 8 remodel domains' },

  // ── flywheel.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/flywheel/runs',                              kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration (run-state telemetry)' },
  { surface: 'GET /api/flywheel/runs/:id',                          kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/flywheel/conversation',                      kind: 'http', disposition: 'RELOCATE',    door: 'Conversations (flywheel agent conversation)' },
  { surface: 'GET /api/flywheel/current',                           kind: 'http', disposition: 'AGGREGATE',   door: 'SettingsResolver.getFlywheelRuntime + run-state' },
  { surface: 'GET /api/flywheel/stats',                             kind: 'http', disposition: 'RELOCATE',    door: 'flywheel telemetry' },
  { surface: 'GET /api/flywheel/config',                            kind: 'http', disposition: 'READ',        door: 'SettingsResolver.getFlywheelConfig' },
  { surface: 'POST /api/flywheel/config',                           kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.setFlywheelConfig' },
  { surface: 'GET /api/flywheel/auto-merge/pending',                kind: 'http', disposition: 'READ',        door: 'MergeResolver.listAutoMerges({active})' },
  { surface: 'GET /api/flywheel/auto-merge/problems',               kind: 'http', disposition: 'READ',        door: 'MergeResolver.listAutoMerges({problems})' },
  { surface: 'GET /api/flywheel/merge-blockers',                    kind: 'http', disposition: 'READ',        door: 'MergeResolver.listBlockers' },
  { surface: 'GET /api/flywheel/merge-backend',                     kind: 'http', disposition: 'READ',        door: 'MergeResolver.getMergeBackendStatus' },
  { surface: 'POST /api/flywheel/auto-merge/schedule',              kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.scheduleAutoMerge' },
  { surface: 'POST /api/flywheel/merge-next',                       kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → POST /api/merge-train/merge-next (takes { n, project }; ready set from review-status, no flywheel run)' },
  { surface: 'DELETE /api/flywheel/auto-merge/:id',                 kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.cancelAutoMerge' },
  { surface: 'POST /api/flywheel/status',                           kind: 'http', disposition: 'RELOCATE',    door: 'flywheel run-state telemetry write' },
  { surface: 'POST /api/flywheel/start',                            kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.startFlywheel + AgentWriter.spawn' },
  { surface: 'POST /api/flywheel/pause',                            kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.pauseFlywheel + AgentWriter.stop' },
  { surface: 'POST /api/flywheel/resume',                           kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.resumeFlywheel + AgentWriter.spawn' },
  { surface: 'POST /api/flywheel/abort',                            kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.abortFlywheel + AgentWriter.stop' },
  { surface: 'POST /api/flywheel/report',                           kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration (telemetry report)' },
  { surface: 'POST /api/flywheel/report/open',                      kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/flywheel/brief',                             kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'POST /api/flywheel/brief',                            kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/flywheel/merge-queue',                       kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → GET /api/merge-train/queues (one entry per tracked project, no flywheel run)' },
  { surface: 'GET /api/flywheel/uat-candidate',                     kind: 'http', disposition: 'READ',        door: 'MergeResolver.getActiveUatCandidate' },
  { surface: 'GET /api/flywheel/uat-generations',                   kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → GET /api/merge-train/generations (per-project chains)' },
  { surface: 'POST /api/flywheel/uat-generations/:name/stack',      kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → POST /api/merge-train/generations/:name/stack (same handler and auth gate)' },
  { surface: 'POST /api/flywheel/uat-generations/:name/promote',    kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → POST /api/merge-train/generations/:name/promote (same handler, auth gate, and firePostMergeLifecycle wiring)' },
  { surface: 'POST /api/flywheel/assemble-uat',                     kind: 'http', disposition: 'RELOCATE',    door: 'REMOVED by PAN-1696 → POST /api/merge-train/assemble (one project via { project }, or every enabled project)' },
  { surface: 'GET /api/flywheel/state',                             kind: 'http', disposition: 'AGGREGATE',   door: 'SettingsResolver.getFlywheelRuntime + run-state' },
  { surface: 'GET /api/flywheel/substrate-bug-weights',             kind: 'http', disposition: 'AGGREGATE',   door: 'SubstrateBugWeightsService.listSubstrateBugWeights + FlywheelStats' },

  // ── hooks.ts ──────────────────────────────────────────────────────────────
  { surface: 'POST /api/memory/inject',                   kind: 'http', disposition: 'READ',        door: 'MemoryResolver.injectPromptTime' },
  { surface: 'POST /api/memory/session/start',            kind: 'http', disposition: 'WRITE',       door: 'MemoryWriter.claimRange (kickoff)' },
  { surface: 'POST /api/memory/turn',                     kind: 'http', disposition: 'WRITE',       door: 'MemoryWriter.extractDelta' },
  { surface: 'POST /api/hooks/permission-event',          kind: 'http', disposition: 'RELOCATE',    door: 'AgentPermissionsWriter' },
  { surface: 'POST /api/hooks/user-prompt-submit',        kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.retitle (derivePromptTitle)' },
  { surface: 'POST /api/hooks/turn-complete',             kind: 'http', disposition: 'WRITE',       door: 'ConversationWriter.retitle + title-refinement service' },

  // ── http-handler.ts ───────────────────────────────────────────────────────
  { surface: 'GET /api/foo',                              kind: 'http', disposition: 'DELETE',      door: 'debug/test stub; no production caller' },

  // ── issues.ts ─────────────────────────────────────────────────────────────
  { surface: 'GET /api/issues',                                     kind: 'http', disposition: 'READ',        door: 'IssuesResolver.list' },
  { surface: 'GET /api/issues/:id/analyze',                         kind: 'http', disposition: 'DELETE',      door: 'ad-hoc analysis helper; no pipeline branch reads it' },
  { surface: 'GET /api/issues/:id/prd',                             kind: 'http', disposition: 'READ',        door: 'getIssuePrd → findDraftPrd + readPrdContent' },
  { surface: 'GET /api/issues/:id/ship-log',                        kind: 'http', disposition: 'AGGREGATE',   door: 'ShipLog runtime ring buffer + ReviewStatus merge state' },
  { surface: 'GET /api/issues/:id/verification',                    kind: 'http', disposition: 'AGGREGATE',   door: 'Verification artifact + ReviewStatus verification state' },
  { surface: 'GET /api/issues/:issueId/staffing',                   kind: 'http', disposition: 'READ',        door: 'Issue record staffing override + resolved configuration' },
  { surface: 'POST /api/issues/:issueId/staffing',                  kind: 'http', disposition: 'WRITE',       door: 'Issue record writer updates the work-model override' },
  { surface: 'GET /api/issues/:id/tasks',                           kind: 'http', disposition: 'READ',        door: 'readWorkspacePlanSync (merged xBRIEF items) + issue record claims' },
  { surface: 'POST /api/issues/:id/tasks/:itemId/inspect',          kind: 'http', disposition: 'WRITE',       door: 'inspectIssueTask → pan inspect dispatch' },
  { surface: 'POST /api/issues/:id/reset-to-planned',               kind: 'http', disposition: 'WRITE',       door: 'reset-to-planned lifecycle writer (IssueLifecycle + record door)' },
  { surface: 'GET /api/issues/:id/beads',                           kind: 'http', disposition: 'RELOCATE',    door: 'Beads (out of remodel scope)' },
  { surface: 'GET /api/issues/:id/planning-state',                  kind: 'http', disposition: 'READ',        door: 'IssuesResolver.get (stage + planRef)' },
  { surface: 'GET /api/issues/:id/pr',                              kind: 'http', disposition: 'READ',        door: 'IssuesResolver.get(.pr) + live GitHub for CI' },
  { surface: 'GET /api/issues/:id/pr/diff',                         kind: 'http', disposition: 'RELOCATE',    door: 'Diffs / live GitHub' },
  { surface: 'GET /api/issues/:id/pr/details',                      kind: 'http', disposition: 'RELOCATE',    door: 'Diffs / live GitHub' },
  { surface: 'GET /api/issues/:id/check-runs',                      kind: 'http', disposition: 'RELOCATE',    door: 'live GitHub' },
  { surface: 'GET /api/issues/:id/discussions',                     kind: 'http', disposition: 'RELOCATE',    door: 'live GitHub' },
  { surface: 'GET /api/issues/:id/costs',                           kind: 'http', disposition: 'RELOCATE',    door: 'CostResolver.issueDetail' },
  { surface: 'GET /api/issues/resource-allocated',                  kind: 'http', disposition: 'READ',        door: 'IssuesResolver.list({resourceAllocated:true})' },
  { surface: 'GET /api/pipeline/membership',                        kind: 'http', disposition: 'READ',        door: 'PipelineMembershipService.getCached()' },
  { surface: 'POST /api/pipeline/membership/refresh',               kind: 'http', disposition: 'READ',        door: 'refreshMembershipSnapshotsForProjects() — operator retry re-gathers the snapshot cache (PAN-2972); no canonical state written' },
  { surface: 'GET /api/issues/:id/resource-details',                kind: 'http', disposition: 'AGGREGATE',   door: 'IssuesResolver.get + AgentsResolver' },
  { surface: 'POST /api/issues/:id/start-planning',                 kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("planning")' },
  { surface: 'POST /api/issues/:id/abort-planning',                 kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","abort-planning") + AgentWriter.stop' },
  { surface: 'POST /api/issues/:id/complete-planning',              kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("planned")' },
  { surface: 'POST /api/issues/:id/abort',                          kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","abort")' },
  { surface: 'POST /api/issues/:id/reset',                          kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","reset")' },
  { surface: 'POST /api/issues/:id/cancel',                         kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("cancelled")' },
  { surface: 'POST /api/issues/:id/reopen',                         kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","reopen")' },
  { surface: 'POST /api/issues/:id/restart-from-plan',              kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("planned","restart-from-plan")' },
  { surface: 'POST /api/issues/:id/move-status',                    kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance(targetStage,reason)' },
  { surface: 'POST /api/issues/:id/cleanup-workspace',              kind: 'http', disposition: 'RELOCATE',    door: 'workspace ops' },
  { surface: 'POST /api/issues/:id/deep-wipe',                      kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","wipe") + RELOCATE workspace teardown' },
  { surface: 'POST /api/issues/:id/copy-settings',                  kind: 'http', disposition: 'RELOCATE',    door: 'Settings' },
  { surface: 'POST /api/issues/:id/close-out',                      kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("closed","close-out")' },
  { surface: 'POST /api/issues/bulk-close-out',                     kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance ×N' },
  { surface: 'POST /api/issues/:issueId/close',                     kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("closed")' },
  { surface: 'POST /api/issues/:id/beads/:itemId/inspect',          kind: 'http', disposition: 'RELOCATE',    door: 'Agents (work.inspect)' },
  { surface: 'POST /api/issues/:id/generate-tasks',                 kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("working") fallback path' },

  // ── knowledge-viewer.ts ───────────────────────────────────────────────────
  { surface: 'GET /api/knowledge-viewer/status',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Optional OpenKnowledge subprocess status; outside 8 remodel domains' },
  { surface: 'POST /api/knowledge-viewer/install',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Progressive third-party viewer installation; outside 8 remodel domains' },
  { surface: 'POST /api/knowledge-viewer/start',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Optional OpenKnowledge subprocess lifecycle; outside 8 remodel domains' },
  { surface: 'GET /knowledge-viewer/*',                              kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Authenticated compatibility redirect to the origin-isolated viewer host' },

  // ── metrics.ts ────────────────────────────────────────────────────────────
  { surface: 'GET /api/metrics/summary',                  kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + Merge' },
  { surface: 'GET /api/metrics/costs',                    kind: 'http', disposition: 'READ',        door: 'CostResolver.summary("day")' },
  { surface: 'GET /api/metrics/stuck',                    kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents (stuck agents)' },
  { surface: 'GET /api/activity',                         kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + events (activity feed)' },
  { surface: 'GET /api/activity/detailed',                kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + events' },
  { surface: 'GET /api/activity/tts',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS activity; outside 8 remodel domains' },
  { surface: 'GET /api/activity/:id',                     kind: 'http', disposition: 'RELOCATE',    door: 'Observability/events (per-issue activity)' },
  { surface: 'GET /api/git-activity',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Git activity feed; outside 8 remodel domains' },

  // ── misc.ts ───────────────────────────────────────────────────────────────
  { surface: 'POST /api/trackers/refresh',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Tracker sync; outside 8 remodel domains' },
  { surface: 'GET /api/project-mappings',                 kind: 'http', disposition: 'RELOCATE',    door: 'Config (project mappings)' },
  { surface: 'PUT /api/project-mappings',                 kind: 'http', disposition: 'RELOCATE',    door: 'Config' },
  { surface: 'POST /api/project-mappings',                kind: 'http', disposition: 'RELOCATE',    door: 'Config' },
  { surface: 'GET /api/system/health',                    kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + Merge' },
  { surface: 'GET /api/godview/system-health',            kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + Merge' },
  { surface: 'GET /api/deploy/staleness',                 kind: 'http', disposition: 'READ',        door: 'Deployment staleness resolver with a shared runtime-decoded contract' },
  { surface: 'GET /api/health/agents',                    kind: 'http', disposition: 'READ',        door: 'AgentsResolver.list (health view)' },
  { surface: 'POST /api/health/agents/:id/ping',          kind: 'http', disposition: 'WRITE',       door: 'AgentWriter.recordHealth (ping)' },
  { surface: 'GET /api/tracker-status',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Tracker connection status; outside 8 remodel domains' },
  { surface: 'POST /api/rally/validate',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Rally validator; outside 8 remodel domains' },
  { surface: 'GET /api/no-resume-mode',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Boot flag probe; outside 8 remodel domains' },
  { surface: 'POST /api/resume-all',                      kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.disableNoResumeMode + AgentWriter.resume ×N' },
  { surface: 'GET /api/deacon/status',                    kind: 'http', disposition: 'READ',        door: 'SettingsResolver.isDeaconPaused + live status' },
  { surface: 'GET /api/deacon/logs',                      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Deacon log stream; outside 8 remodel domains' },
  { surface: 'POST /api/deacon/patrol',                   kind: 'http', disposition: 'RELOCATE',    door: 'CloisterRuntime.patrol (residue)' },
  { surface: 'GET /api/deacon/pause',                     kind: 'http', disposition: 'READ',        door: 'SettingsResolver.isDeaconPaused' },
  { surface: 'POST /api/deacon/pause',                    kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.setDeaconPaused' },
  { surface: 'GET /api/version',                          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Build version probe; outside 8 remodel domains' },
  { surface: 'GET /api/registered-projects',              kind: 'http', disposition: 'READ',        door: 'ConfigResolver.listProjects' },
  { surface: 'POST /api/projects',                        kind: 'http', disposition: 'WRITE',       door: 'ConfigWriter.registerProject (mode=existing) / createProject (mode=new)' },
  { surface: 'GET /api/fs/list-dirs',                     kind: 'http', disposition: 'READ',        door: 'FilesystemResolver.listDirs (folder-browser for project registration)' },
  { surface: 'GET /api/confirmations',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Confirmation prompts; outside 8 remodel domains' },
  { surface: 'POST /api/confirmations/:id/respond',       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Confirmation prompts; outside 8 remodel domains' },
  { surface: 'GET /api/skills',                           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Skills index; outside 8 remodel domains' },
  { surface: 'GET /api/planning/:issueId/status',         kind: 'http', disposition: 'READ',        door: 'IssuesResolver.get (planning status)' },
  { surface: 'POST /api/planning/:issueId/message',       kind: 'http', disposition: 'RELOCATE',    door: 'ConversationRuntime.deliver (planning session)' },
  { surface: 'DELETE /api/planning/:issueId',             kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","abort-planning") + AgentWriter.stop' },
  { surface: 'GET /api/services/tldr/status',             kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR service; outside 8 remodel domains' },
  { surface: 'POST /api/services/tldr/start',             kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR service; outside 8 remodel domains' },
  { surface: 'POST /api/services/tldr/stop',              kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR service; outside 8 remodel domains' },
  { surface: 'POST /api/services/tldr/reload',            kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR service; outside 8 remodel domains' },
  { surface: 'GET /api/cache-status',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Cache diagnostics; outside 8 remodel domains' },
  { surface: 'POST /api/cache/clear',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Cache diagnostics; outside 8 remodel domains' },
  { surface: 'GET /api/metrics/runtimes',                 kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents (runtime metrics)' },
  { surface: 'GET /api/metrics/tasks',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Tasks metrics; outside 8 remodel domains' },
  { surface: 'POST /api/shadow/:issueId/monitor',         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Shadow mode; outside 8 remodel domains' },
  { surface: 'POST /api/shadow/:issueId/observe',         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Shadow mode; outside 8 remodel domains' },
  { surface: 'POST /api/dev/rebuild',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Dev-mode rebuild trigger; outside 8 remodel domains' },
  { surface: 'POST /api/system/restart-dashboard',        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Dashboard restart; outside 8 remodel domains' },

  // ── palette.ts ────────────────────────────────────────────────────────────
  { surface: 'GET /api/palette/commands',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Command palette index; outside 8 remodel domains' },
  { surface: 'GET /api/palette/search',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Command palette search; outside 8 remodel domains' },

  // ── prereqs.ts ────────────────────────────────────────────────────────────
  { surface: 'GET /api/prereqs',                          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Prerequisites check; outside 8 remodel domains' },
  { surface: 'GET /api/prereqs/:feature',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Prerequisites check; outside 8 remodel domains' },
  { surface: 'POST /api/prereqs/install',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Prerequisites install; outside 8 remodel domains' },

  // ── projects.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/projects/:projectKey/session-tree',          kind: 'http', disposition: 'RELOCATE',    door: 'Conversations (session tree)' },
  { surface: 'GET /api/projects/:projectKey/release-status',        kind: 'http', disposition: 'READ',        door: 'ProjectPipelinesResolver.fetchProjectReleaseStatus (PAN-2555)' },
  { surface: 'GET /api/session-trees',                              kind: 'http', disposition: 'RELOCATE',    door: 'Conversations' },
  { surface: 'GET /api/projects/:projectKey/auto-merge-default',    kind: 'http', disposition: 'READ',        door: 'ConfigResolver.getProject (autoMergeDefault field)' },
  { surface: 'POST /api/projects/:projectKey/auto-merge-default',   kind: 'http', disposition: 'RELOCATE',    door: 'Config (ConfigWriter.setAutoMergeDefault, to be designed)' },
  { surface: 'POST /api/projects/:projectKey/rename',               kind: 'http', disposition: 'WRITE',       door: 'Project registry rename write door (renameProject)' },
  { surface: 'GET /api/projects/:projectKey/merge-train',           kind: 'http', disposition: 'READ',        door: 'ConfigResolver.getProject (merge_train override + effective state, PAN-1696)' },
  { surface: 'POST /api/projects/:projectKey/merge-train',          kind: 'http', disposition: 'WRITE',       door: 'Project config writer sets the per-project merge-train override (setProjectMergeTrainSync, PAN-1696)' },
  { surface: 'GET /api/projects/:projectKey/version-sync',          kind: 'http', disposition: 'AGGREGATE',   door: 'Project config resolver plus durable per-issue ship records for the latest project outcome' },
  { surface: 'PUT /api/projects/:projectKey/version-sync',          kind: 'http', disposition: 'WRITE',       door: 'Lossless project version_sync write door (setProjectVersionSync)' },

  // ── merge-train.ts (PAN-1696: aggregate namespace, superset of the /api/flywheel merge-train routes) ──
  { surface: 'GET /api/merge-train/queues',                         kind: 'http', disposition: 'AGGREGATE',   door: 'Merge-train queues across all tracked projects (review-status ready set, no flywheel run)' },
  { surface: 'GET /api/merge-train/generations',                    kind: 'http', disposition: 'AGGREGATE',   door: 'UAT generation chains across all tracked projects (getUatGenerationsPayload per project)' },
  { surface: 'POST /api/merge-train/generations/:name/stack',       kind: 'http', disposition: 'WRITE',       door: 'UAT stack write door (postUatGenerationStackPayload) — supersedes POST /api/flywheel/uat-generations/:name/stack' },
  { surface: 'POST /api/merge-train/generations/:name/promote',     kind: 'http', disposition: 'WRITE',       door: 'UAT promote write door (postUatGenerationPromotePayload + firePostMergeLifecycle) — supersedes POST /api/flywheel/uat-generations/:name/promote' },
  { surface: 'POST /api/merge-train/generations/:name/ship',        kind: 'http', disposition: 'WRITE',       door: 'Batch-scoped version ship runner plus durable per-member ship record write door' },
  { surface: 'POST /api/merge-train/assemble',                      kind: 'http', disposition: 'WRITE',       door: 'Forced UAT reconcile for one project or all — supersedes POST /api/flywheel/assemble-uat' },
  { surface: 'POST /api/merge-train/merge-next',                    kind: 'http', disposition: 'WRITE',       door: 'Escape-hatch batch merge from a named project ready set — supersedes POST /api/flywheel/merge-next' },

  // ── parked.ts (PAN-3485 phase 1) ────────────────────────────────────────────
  { surface: 'GET /api/parked',                                      kind: 'http', disposition: 'READ',        door: 'resolveParkedPopulation (parked resolver over review_status rows ∪ registered agents)' },

  // ── velocity.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/velocity',                                    kind: 'http', disposition: 'AGGREGATE',   door: 'EventStoreService transitions + resolveParkedPopulation (rolling-window pipeline velocity report)' },

  // ── remote.ts ─────────────────────────────────────────────────────────────
  { surface: 'GET /api/remote/status',                                      kind: 'http', disposition: 'RELOCATE',    door: 'Infra/Settings (remote substrate health)' },
  { surface: 'GET /api/remote/workspaces',                                  kind: 'http', disposition: 'RELOCATE',    door: 'Workspace' },
  { surface: 'GET /api/remote/workspaces/:issueId',                         kind: 'http', disposition: 'RELOCATE',    door: 'Workspace' },
  { surface: 'POST /api/remote/workspaces/:issueId/start',                  kind: 'http', disposition: 'RELOCATE',    door: 'Workspace' },
  { surface: 'POST /api/remote/workspaces/:issueId/stop',                   kind: 'http', disposition: 'RELOCATE',    door: 'Workspace' },
  { surface: 'POST /api/remote/workspaces/:issueId/agent/start',            kind: 'http', disposition: 'WRITE',       door: 'AgentWriter.spawn(host:"fly")' },
  { surface: 'POST /api/remote/workspaces/:issueId/agent/stop',             kind: 'http', disposition: 'WRITE',       door: 'AgentWriter.stop' },
  { surface: 'GET /api/remote/workspaces/:issueId/agent/output',            kind: 'http', disposition: 'RELOCATE',    door: 'Transcripts' },
  { surface: 'POST /api/remote/workspaces/:issueId/agent/tell',             kind: 'http', disposition: 'RELOCATE',    door: 'DeliveryService.tell (host-aware)' },

  // ── resources.ts ──────────────────────────────────────────────────────────
  { surface: 'GET /api/resources',                                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker/container resource service; outside 8 remodel domains' },
  { surface: 'GET /api/resources/:containerId/history',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker/container resource service; outside 8 remodel domains' },
  { surface: 'GET /api/resources/:containerId/details',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker/container resource service; outside 8 remodel domains' },
  { surface: 'DELETE /api/resources/docker/container/:id',        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'POST /api/resources/docker/prune-containers',       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'DELETE /api/resources/docker/network/:name',        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'DELETE /api/resources/docker/volume/:name',         kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'POST /api/resources/docker/prune-volumes',          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'POST /api/resources/docker/container/:id/restart',  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'POST /api/resources/docker/container/:id/start',    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },
  { surface: 'GET /api/resources/docker/container/:id/logs',      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker resource management; outside 8 remodel domains' },

  // ── settings.ts ───────────────────────────────────────────────────────────
  { surface: 'GET /api/settings',                                    kind: 'http', disposition: 'READ',        door: 'FILE-CONFIG (~/.overdeck/config.yaml)' },
  { surface: 'GET /api/settings/available-models',                   kind: 'http', disposition: 'READ',        door: 'FILE-CONFIG/catalog' },
  { surface: 'GET /api/settings/optimal-defaults',                   kind: 'http', disposition: 'READ',        door: 'FILE-CONFIG/catalog' },
  { surface: 'GET /api/settings/minimax-defaults',                   kind: 'http', disposition: 'READ',        door: 'FILE-CONFIG/catalog' },
  { surface: 'GET /api/settings/claude-auth',                        kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'GET /api/settings/openai-auth',                        kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'POST /api/settings/test-api-key',                      kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'POST /api/settings/validate-api-key',                  kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'GET /api/settings/conversation-search/status',         kind: 'http', disposition: 'RELOCATE',    door: 'Conversations/search' },
  { surface: 'GET /api/settings/conversation-search/reindex-estimate', kind: 'http', disposition: 'RELOCATE',  door: 'Conversations/search' },
  { surface: 'POST /api/settings/conversation-search/reindex',       kind: 'http', disposition: 'RELOCATE',    door: 'Conversations/search' },
  { surface: 'GET /api/settings/conversation-search/reindex-progress', kind: 'http', disposition: 'RELOCATE',  door: 'Conversations/search' },
  { surface: 'PUT /api/settings',                                    kind: 'http', disposition: 'WRITE',       door: 'FILE-CONFIG' },
  { surface: 'PUT /api/settings/ui-theme',                           kind: 'http', disposition: 'WRITE',       door: 'FILE-CONFIG (ui-theme.json)' },
  { surface: 'PUT /api/settings/design-language',                    kind: 'http', disposition: 'WRITE',       door: 'FILE-CONFIG via saveDesignLanguage (theme-only merge)' },
  { surface: 'GET /api/settings/openrouter/models',                  kind: 'http', disposition: 'RELOCATE',    door: 'OpenRouter service' },
  { surface: 'PUT /api/settings/openrouter/favorites',               kind: 'http', disposition: 'WRITE',       door: 'FILE-CONFIG' },
  { surface: 'PUT /api/settings/openrouter/api-key',                 kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'POST /api/settings/openrouter/test-key',               kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'GET /api/settings/harness-policy',                     kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth/harness-policy' },
  { surface: 'GET /api/settings/provider-env-conflicts',             kind: 'http', disposition: 'RELOCATE',    door: 'provider-auth' },
  { surface: 'GET /api/settings/legacy-import/conversations',        kind: 'http', disposition: 'READ',        door: 'previewLegacyConversations (src/lib/overdeck/legacy-import.ts)' },
  { surface: 'POST /api/settings/legacy-import/conversations',       kind: 'http', disposition: 'WRITE',       door: 'importLegacyConversations → importLegacyConversation write door' },

  // ── show.ts ───────────────────────────────────────────────────────────────
  { surface: 'GET /api/show/:issueId',                    kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + Cost' },
  { surface: 'GET /api/show/:issueId/agents',             kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents' },
  { surface: 'GET /api/show/:issueId/summary',            kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + Cost summary' },
  { surface: 'GET /api/show/:issueId/shadow',             kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Shadow mode detail; outside 8 remodel domains' },
  { surface: 'GET /api/show/:issueId/health',             kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents (health view)' },

  // ── specialists.ts ────────────────────────────────────────────────────────
  { surface: 'GET /api/specialists',                                             kind: 'http', disposition: 'READ',        door: 'AgentsResolver.list({role})' },
  { surface: 'POST /api/specialists/reset-all',                                  kind: 'http', disposition: 'DELETE',      door: 'legacy named-specialist reset machinery removed' },
  { surface: 'POST /api/specialists/done',                                       kind: 'http', disposition: 'RELOCATE',    door: 'IssueWriter.advance + IssueWriter.setPr' },
  { surface: 'POST /api/specialists/logs/cleanup-all',                           kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration/logs' },
  { surface: 'GET /api/specialists/projects',                                    kind: 'http', disposition: 'READ',        door: 'AgentsResolver.list({role}) grouped' },
  { surface: 'POST /api/specialists/:name/wake',                                 kind: 'http', disposition: 'DELETE',      door: 'legacy named-specialist wake removed' },
  { surface: 'POST /api/specialists/:name/reset',                                kind: 'http', disposition: 'DELETE',      door: 'legacy named-specialist reset removed' },
  { surface: 'POST /api/specialists/:name/init',                                 kind: 'http', disposition: 'DELETE',      door: 'legacy specialist session init removed' },
  { surface: 'POST /api/specialists/:name/report-status',                        kind: 'http', disposition: 'RELOCATE',    door: 'IssueWriter.advance' },
  { surface: 'GET /api/specialists/:name/cost',                                  kind: 'http', disposition: 'DELETE',      door: 'hardcoded zero stub; returns {cost:0} unconditionally' },
  { surface: 'POST /api/specialists/:name/auto-complete',                        kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:issueId/:type/status',              kind: 'http', disposition: 'RELOCATE',    door: 'IssuesResolver.get' },
  { surface: 'POST /api/specialists/:project/:issueId/:type/kill',               kind: 'http', disposition: 'WRITE',       door: 'AgentWriter.stop' },
  { surface: 'GET /api/specialists/:project/:type/runs',                         kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:type/runs/:runId/stream',           kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:type/runs/:runId',                  kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'POST /api/specialists/:project/:type/runs/:runId/terminate',       kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration + AgentWriter.stop' },
  { surface: 'POST /api/specialists/:project/:type/grace/pause',                 kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'POST /api/specialists/:project/:type/grace/resume',                kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'POST /api/specialists/:project/:type/grace/exit',                  kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:type/grace',                        kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:type/context',                      kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration (review context)' },
  { surface: 'POST /api/specialists/:project/:type/context/regenerate',          kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'POST /api/specialists/:project/:type/complete',                    kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration' },
  { surface: 'GET /api/specialists/:project/:type/latest-log',                   kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration/logs' },
  { surface: 'POST /api/specialists/:project/:type/logs/cleanup',                kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration/logs' },
  { surface: 'POST /api/specialists/projects/:project/:name/reset-session',      kind: 'http', disposition: 'WRITE',       door: 'AgentWriter.switchModel (session-clear)' },
  { surface: 'POST /api/specialists/:project/:issueId/review/restart',           kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration + AgentWriter.spawn' },
  { surface: 'POST /api/specialists/:project/:issueId/reviewer/:role/restart',   kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration + AgentWriter.spawn' },
  { surface: 'GET /api/models/resolve',                                          kind: 'http', disposition: 'RELOCATE',    door: 'Settings' },

  // ── tiered-callouts.ts ────────────────────────────────────────────────────
  { surface: 'POST /api/tiered/callouts',                 kind: 'http', disposition: 'RELOCATE',    door: 'Tiered execution supervisor/callout orchestration' },

  // ── terminals.ts ──────────────────────────────────────────────────────────
  { surface: 'POST /api/terminals',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Terminal management; outside 8 remodel domains' },
  { surface: 'DELETE /api/terminals/:name',               kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Terminal management; outside 8 remodel domains' },

  // ── tts.ts ────────────────────────────────────────────────────────────────
  { surface: 'GET /api/tts/status',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/speak',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/stop',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'GET /api/tts/queue',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'DELETE /api/tts/queue',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/config',                      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'GET /api/tts/voices',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/test',                        kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'GET /api/tts/health',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/start',                       kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/voices',                      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'DELETE /api/tts/voices',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'DELETE /api/tts/voices/:id',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },
  { surface: 'POST /api/tts/extract-embedding',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TTS service; outside 8 remodel domains' },

  // ── voice.ts ──────────────────────────────────────────────────────────────
  { surface: 'POST /api/voice/transcribe',                kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Voice STT; outside 8 remodel domains' },
  { surface: 'GET /api/voice/status',                     kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Voice STT; outside 8 remodel domains' },
  { surface: 'GET /api/voice/settings',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Voice STT; outside 8 remodel domains' },
  { surface: 'PUT /api/voice/settings',                   kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Voice STT; outside 8 remodel domains' },

  // ── webhooks.ts ───────────────────────────────────────────────────────────
  { surface: 'POST /api/webhooks/github',                 kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.setPr + IssueWriter.setBlockers' },

  // ── workspaces.ts ─────────────────────────────────────────────────────────
  { surface: 'GET /api/workspace-stack-health',                      kind: 'http', disposition: 'AGGREGATE',   door: 'Issues + Agents + stack health' },
  { surface: 'GET /api/workspaces/:issueId',                         kind: 'http', disposition: 'AGGREGATE',   door: 'IssuesResolver.get + AgentsResolver + workspace details' },
  { surface: 'POST /api/workspaces',                                 kind: 'http', disposition: 'WRITE',       door: 'IssueWriter (workspace creation path)' },
  { surface: 'POST /api/workspaces/:issueId/rebuild-stack',          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Stack rebuild; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/rebuild-and-start',      kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Stack rebuild + chained agent start via pan CLI; outside 8 remodel domains' },
  { surface: 'GET /api/workspaces/:issueId/state-md',                kind: 'http', disposition: 'READ',        door: 'IssuesResolver.get (state doc)' },
  { surface: 'GET /api/workspaces/:issueId/inference-md',            kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Inference doc; outside 8 remodel domains' },
  { surface: 'GET /api/workspaces/:issueId/plan',                    kind: 'http', disposition: 'READ',        door: 'IssuesResolver.getPlan' },
  { surface: 'GET /api/workspaces/:issueId/uat-context',             kind: 'http', disposition: 'RELOCATE',    door: 'Orchestration (UAT context)' },
  { surface: 'PATCH /api/workspaces/:issueId/plan/inspection-policy', kind: 'http', disposition: 'WRITE',      door: 'SettingsWriter (bead inspection policy)' },
  { surface: 'GET /api/workspaces/:issueId/stashes',                 kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Git stash ops; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/stashes/:stashRef/recover', kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Git stash ops; outside 8 remodel domains' },
  { surface: 'DELETE /api/workspaces/:issueId/stashes/:stashRef',    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Git stash ops; outside 8 remodel domains' },
  { surface: 'GET /api/workspaces/:issueId/clean/preview',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Workspace clean ops; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/clean',                  kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Workspace clean ops; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/containerize',           kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker ops; outside 8 remodel domains' },
  { surface: 'POST /api/issues/:issueId/start',                      kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("working") + AgentWriter.spawn' },
  { surface: 'POST /api/workspaces/:issueId/containers/:containerName/:action', kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Docker ops; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/memory-summary',         kind: 'http', disposition: 'WRITE',       door: 'MemoryWriter.generateSummary' },
  { surface: 'POST /api/workspaces/:issueId/refresh-db',             kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'DB refresh; outside 8 remodel domains' },

  // ── workspace-registry.ts (PAN-1990, distinct from workspaces.ts above) ────
  { surface: 'GET /api/workspace-registry',                          kind: 'http', disposition: 'READ',        door: 'workspaces/resolver.ts (listWorkspaces + review-status badge)' },
  { surface: 'GET /api/workspace-registry/:id',                      kind: 'http', disposition: 'READ',        door: 'workspaces/resolver.ts (getWorkspaceById)' },
  { surface: 'GET /api/workspace-registry/:id/memory',                kind: 'http', disposition: 'READ',        door: 'MemoryResolver (readCurrentStatus + readRecentObservations)' },
  { surface: 'POST /api/workspace-registry/:id/activate',             kind: 'http', disposition: 'WRITE',       door: 'workspaces/writer.ts (touchWorkspaceAccessed)' },
  { surface: 'POST /api/workspace-registry/:id/archive',              kind: 'http', disposition: 'WRITE',       door: 'workspaces/writer.ts (archiveWorkspace/unarchiveWorkspace)' },
  { surface: 'POST /api/workspace-registry/:id/favorite',             kind: 'http', disposition: 'WRITE',       door: 'workspaces/writer.ts (setWorkspaceFavorite)' },
  { surface: 'PUT /api/workspace-registry/:id/layout',                kind: 'http', disposition: 'WRITE',       door: 'workspaces/writer.ts (updateWorkspaceLayout)' },
  // PAN-3330: dashboard workspace creation/management. resolve is a POST only
  // because it carries a body — it writes nothing and is asserted write-free.
  { surface: 'POST /api/workspace-registry/resolve',                  kind: 'http', disposition: 'READ',        door: 'workspaces/create.ts (resolveWorkspaceCreateIntent — dry run, no writes)' },
  { surface: 'POST /api/workspace-registry',                          kind: 'http', disposition: 'WRITE',       door: 'workspaces/create.ts (performWorkspaceCreate → writer.ts createWorkspace)' },
  { surface: 'POST /api/workspace-registry/:id/relocate',             kind: 'http', disposition: 'RELOCATE',    door: 'workspaces/writer.ts (relocateWorkspace)' },
  { surface: 'GET /api/workspace-registry/project-targets',           kind: 'http', disposition: 'READ',        door: 'projects.ts (listProjectsAsync) + workspaces/resolver.ts (listProjectTargets)' },
  // PAN-3331 quick-action band.
  { surface: 'GET /api/workspace-registry/:id/git',                   kind: 'http', disposition: 'READ',        door: 'workspaces/git-state.ts (getWorkspaceGitState) via workspaces/resolver.ts for the row' },
  { surface: 'POST /api/workspace-registry/:id/pull',                 kind: 'http', disposition: 'WRITE',       door: 'workspaces/git-state.ts (pullWorkspaceFastForward); kind=issue is refused and keeps using POST /api/issues/:issueId/sync-main' },
  { surface: 'PUT /api/workspace-registry/:id/run-command',           kind: 'http', disposition: 'WRITE',       door: 'workspaces/writer.ts (setWorkspaceRunCommand)' },
  { surface: 'POST /api/workspace-registry/:id/run',                  kind: 'http', disposition: 'WRITE',       door: 'lib/tmux.ts (createSession) for the run session; workspaces/resolver.ts + projects.ts resolve the command' },
  { surface: 'POST /api/workspace-registry/:id/open',                 kind: 'http', disposition: 'WRITE',       door: 'lib/browser.ts (openPath/openInEditor); editor gated on config-yaml ui.open_in_editor_command' },
  { surface: 'GET /api/review/:issueId/status',                      kind: 'http', disposition: 'READ',        door: 'IssuesResolver.get (reviewOutcome + testOutcome + verificationOutcome)' },
  { surface: 'POST /api/review/:issueId/status',                     kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance (verdict edge)' },
  { surface: 'POST /api/review/:issueId/trigger',                    kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("in_review")' },
  { surface: 'POST /api/review/:issueId/request',                    kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("in_review")' },
  { surface: 'POST /api/review/:issueId/reset',                      kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("working")' },
  { surface: 'POST /api/review/:issueId/abort',                      kind: 'http', disposition: 'RELOCATE',    door: 'AgentWriter.stop (reviewers)' },
  { surface: 'POST /api/workspaces/:issueId/unstick',                kind: 'http', disposition: 'RELOCATE',    door: 'Settings (clear stuck, ephemeral review-run runtime)' },
  { surface: 'POST /api/workspaces/:issueId/deacon-ignore',          kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.setDeaconIgnored' },
  { surface: 'POST /api/workspaces/:issueId/auto-merge',             kind: 'http', disposition: 'WRITE',       door: 'SettingsWriter.setAutoMerge' },
  { surface: 'POST /api/issues/:issueId/sync-main',                  kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.rebaseOntoMain' },
  { surface: 'POST /api/issues/:issueId/merge',                      kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.merge' },
  { surface: 'POST /api/issues/:issueId/forge-approve',              kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.approveForge' },
  { surface: 'POST /api/issues/:issueId/forge-merge',                kind: 'http', disposition: 'WRITE',       door: 'MergeWriter.merge (per-repo path)' },
  { surface: 'POST /api/issues/:issueId/approve',                    kind: 'http', disposition: 'WRITE',       door: 'IssueWriter.advance("merging")' },
  { surface: 'DELETE /api/review/:issueId/pending',                  kind: 'http', disposition: 'DELETE',      door: 'ready_for_merge is now derived; explicit clear verb unnecessary' },
  { surface: 'GET /api/workspaces/:issueId/tldr',                    kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'TLDR workspace context; outside 8 remodel domains' },
  { surface: 'POST /api/workspaces/:issueId/refresh-token',          kind: 'http', disposition: 'OUT_OF_SCOPE', door: 'Auth token refresh; outside 8 remodel domains' },
  { surface: 'GET /api/merge-queue',                                 kind: 'http', disposition: 'READ',        door: 'MergeResolver.listQueues' },
  { surface: 'POST /api/internal/pipeline/notify',                   kind: 'http', disposition: 'DELETE',      door: 'replaced by writer\'s own bus.emit; side-channel eliminated' },

  // ══════════════════════════════════════════════════════════════════════════
  // RPC methods (pan.* — WebSocket RPC via ObservabilityRpcGroup and friends)
  // ══════════════════════════════════════════════════════════════════════════

  // Conversations / discovered sessions
  { surface: 'pan.scanConversations',           kind: 'rpc', disposition: 'WRITE',       door: 'TranscriptsWriter.scan' },
  { surface: 'pan.searchConversations',         kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.search' },
  { surface: 'pan.listSessionsFeed',            kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.sessionsFeed' },
  { surface: 'pan.getSessionsFeedFacets',       kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.sessionsFeedFacets' },
  { surface: 'pan.listDiscoveredSessions',      kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.list' },
  { surface: 'pan.getDiscoveredSession',        kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.get' },
  { surface: 'pan.enrichSessions',             kind: 'rpc', disposition: 'WRITE',       door: 'TranscriptsWriter.enrich' },
  { surface: 'pan.embedSessions',              kind: 'rpc', disposition: 'WRITE',       door: 'TranscriptsWriter.embed' },
  { surface: 'pan.getConversationCost',        kind: 'rpc', disposition: 'READ',        door: 'CostResolver.byConversation' },
  { surface: 'pan.getConversationCostByWorkspace', kind: 'rpc', disposition: 'READ',   door: 'CostResolver.byWorkspace' },
  { surface: 'pan.getConversationStats',       kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.stats' },

  // Streaming subscriptions
  { surface: 'pan.subscribeDomainEvents',      kind: 'rpc', disposition: 'READ',        door: 'Observability.subscribeDomainEvents' },
  { surface: 'pan.subscribeIssueEvents',       kind: 'rpc', disposition: 'READ',        door: 'Observability.subscribeIssueEvents' },
  { surface: 'pan.subscribeTerminal',          kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.subscribeAgentOutput',       kind: 'rpc', disposition: 'READ',        door: 'TranscriptsResolver.streamOutput' },
  { surface: 'pan.subscribeConversationMessages', kind: 'rpc', disposition: 'READ',     door: 'TranscriptsResolver.streamMessages' },
  { surface: 'pan.subscribeProjectSessionTree', kind: 'rpc', disposition: 'READ',       door: 'ConversationsResolver.sessionTree' },
  { surface: 'pan.subscribeFlywheelStatus',    kind: 'rpc', disposition: 'READ',        door: 'SettingsResolver.getFlywheelRuntime (live)' },

  // Snapshot / replay — ObservabilityRpcGroup
  { surface: 'pan.getSnapshot',                kind: 'rpc', disposition: 'READ',        door: 'Observability.getSnapshot' },
  { surface: 'pan.replayEvents',               kind: 'rpc', disposition: 'READ',        door: 'Observability.replayEvents' },

  // Workspace detail
  { surface: 'pan.getWorkspaceDetail',         kind: 'rpc', disposition: 'AGGREGATE',   door: 'IssuesResolver.get + AgentsResolver + workspace details' },
  { surface: 'pan.readWorkspaceFile',          kind: 'rpc', disposition: 'RELOCATE',    door: 'Workspace (file read)' },
  { surface: 'pan.resolveFilePathExists',      kind: 'rpc', disposition: 'RELOCATE',    door: 'Workspace (path probe)' },
  { surface: 'pan.readFileAtPath',             kind: 'rpc', disposition: 'RELOCATE',    door: 'File-at-path door (src/dashboard/server/services/file-at-path.ts, PAN-3260)' },
  { surface: 'pan.writeFileAtPath',            kind: 'rpc', disposition: 'RELOCATE',    door: 'File-at-path door (src/dashboard/server/services/file-at-path.ts, PAN-3260)' },

  // Terminal control
  { surface: 'pan.terminalOpen',               kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.terminalWrite',              kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.terminalResize',             kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.terminalClose',              kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },

  // Command RPCs
  { surface: 'pan.startPlanning',              kind: 'rpc', disposition: 'WRITE',       door: 'IssueWriter.advance("planning") + AgentWriter.spawn' },
  { surface: 'pan.startAgent',                 kind: 'rpc', disposition: 'WRITE',       door: 'IssueWriter.advance("working") + AgentWriter.spawn' },
  { surface: 'pan.deepWipe',                   kind: 'rpc', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","wipe") + workspace teardown' },
  { surface: 'pan.sendTerminalInput',          kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.resizeTerminal',             kind: 'rpc', disposition: 'RELOCATE',    door: 'Terminal RPC (ws-terminal.ts)' },
  { surface: 'pan.shellOpenInEditor',          kind: 'rpc', disposition: 'OUT_OF_SCOPE', door: 'Shell editor open; outside 8 remodel domains' },
  { surface: 'pan.getAvailableEditors',        kind: 'rpc', disposition: 'OUT_OF_SCOPE', door: 'Editor discovery; outside 8 remodel domains' },

  // ══════════════════════════════════════════════════════════════════════════
  // CLI verbs (`pan <verb>`) — from issues.md Part-1 table (primary)
  // ══════════════════════════════════════════════════════════════════════════

  { surface: 'pan plan <id>',                  kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("planning") + IssueWriter.advance("planned") on finalize' },
  { surface: 'pan plan finalize <id>',         kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("planned")' },
  { surface: 'pan start <id>',                 kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("working") + AgentWriter.spawn' },
  { surface: 'pan done <id>',                  kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("in_review") + IssueWriter.setPr' },
  { surface: 'pan move-status <id>',           kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance(targetStage,reason)' },
  { surface: 'pan reopen <id>',                kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","reopen")' },
  { surface: 'pan close <id>',                 kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("closed","close-out")' },
  { surface: 'pan wipe <id>',                  kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("todo","wipe") + workspace teardown' },
  { surface: 'pan approve <id>',               kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("merging")' },
  { surface: 'pan review pending',             kind: 'cli', disposition: 'READ',        door: 'IssuesResolver.list({readyForMerge})' },
  { surface: 'pan review request <id>',        kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("in_review")' },
  { surface: 'pan review reset <id>',          kind: 'cli', disposition: 'WRITE',       door: 'IssueWriter.advance("working")' },
  { surface: 'pan review abort <id>',          kind: 'cli', disposition: 'RELOCATE',    door: 'AgentWriter.stop (reviewers)' },
  { surface: 'pan review restart <id>',        kind: 'cli', disposition: 'RELOCATE',    door: 'AgentWriter (respawn reviewers)' },
  { surface: 'pan review spawn-reviewer <id>', kind: 'cli', disposition: 'RELOCATE',    door: 'AgentWriter.spawn (convoy sub-role)' },
  { surface: 'pan pause <id>',                 kind: 'cli', disposition: 'WRITE',       door: 'AgentWriter.pause' },
  { surface: 'pan unpause <id>',               kind: 'cli', disposition: 'WRITE',       door: 'AgentWriter.unpause' },
  { surface: 'pan untroubled <id>',            kind: 'cli', disposition: 'WRITE',       door: 'AgentWriter.clearTroubled' },
  { surface: 'pan kill <id>',                  kind: 'cli', disposition: 'RELOCATE',    door: 'AgentWriter.stop (preserve workspace)' },
  { surface: 'pan resume <id>',                kind: 'cli', disposition: 'WRITE',       door: 'AgentWriter.resume' },
  { surface: 'pan recover <id>',               kind: 'cli', disposition: 'RELOCATE',    door: 'AgentWriter (orphan recovery)' },
  { surface: 'pan sync-main <id>',             kind: 'cli', disposition: 'RELOCATE',    door: 'MergeWriter.rebaseOntoMain' },
  { surface: 'pan tell <id>',                  kind: 'cli', disposition: 'RELOCATE',    door: 'DeliveryService.tell' },
  { surface: 'pan show <id>',                  kind: 'cli', disposition: 'AGGREGATE',   door: 'Issues + Agents + Cost' },
  { surface: 'pan status',                     kind: 'cli', disposition: 'AGGREGATE',   door: 'system overview — cross-domain' },

  // Merge / UAT CLI verbs (from merge.md Part-1)
  { surface: 'pan merge <id>',                 kind: 'cli', disposition: 'WRITE',       door: 'MergeWriter.merge' },
  { surface: 'pan approve-merge <id>',         kind: 'cli', disposition: 'WRITE',       door: 'MergeWriter.approveForge' },
  { surface: 'pan uat <id>',                   kind: 'cli', disposition: 'WRITE',       door: 'MergeWriter.assembleUat / startUatStack' },

  // Cost CLI verbs (from cost.md Part-1)
  { surface: 'pan costs',                      kind: 'cli', disposition: 'READ',        door: 'CostResolver.summary' },
  { surface: 'pan costs rebuild',              kind: 'cli', disposition: 'WRITE',       door: 'CostWriter.rebuild' },
  { surface: 'pan costs reconcile',            kind: 'cli', disposition: 'WRITE',       door: 'CostWriter.reconcile' },
  { surface: 'pan costs sync-wal',             kind: 'cli', disposition: 'WRITE',       door: 'CostWriter.reconcile({source:"wal"})' },

  // Memory CLI verbs (from memory.md Part-1)
  { surface: 'pan memory search <query>',      kind: 'cli', disposition: 'READ',        door: 'MemoryResolver.search' },
  { surface: 'pan memory inject',              kind: 'cli', disposition: 'READ',        door: 'MemoryResolver.injectPromptTime' },

  // Flywheel / settings CLI verbs (from control-settings.md Part-1)
  { surface: 'pan flywheel start',             kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.startFlywheel + AgentWriter.spawn' },
  { surface: 'pan flywheel pause',             kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.pauseFlywheel + AgentWriter.stop' },
  { surface: 'pan flywheel resume',            kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.resumeFlywheel + AgentWriter.spawn' },
  { surface: 'pan flywheel stop',              kind: 'cli', disposition: 'WRITE',       door: 'clearFlywheelGate + AgentWriter.stop + Orchestration report' },
  { surface: 'pan flywheel abort',             kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.abortFlywheel + AgentWriter.stop' },
  { surface: 'pan deacon pause',               kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.setDeaconPaused(true)' },
  { surface: 'pan deacon unpause',             kind: 'cli', disposition: 'WRITE',       door: 'SettingsWriter.setDeaconPaused(false)' },

  // ── Dead-path deletions (workspace-1ee26) ────────────────────────────────────
  // Scripts and schema artifacts dropped during the dead-path cleanup pass.
  // Accounted here so the no-loss audit can verify nothing load-bearing was
  // silently removed. AC1 (live-caller relocation) was moved to jx0iq scope.

  // scripts/sweep-zombie-specialist-state.ts deleted: swept zombie state.json dirs
  // for the named-specialist role model, which was fully removed. Not imported or
  // referenced anywhere in src/ or scripts/ — confirmed by grep.
  { surface: 'script: sweep-zombie-specialist-state.ts', kind: 'cli', disposition: 'DELETE',       door: 'legacy named-specialist zombie-sweep; specialist role model removed (CLAUDE.md); not referenced anywhere' },

  // api_cache and rate_limits in src/lib/database/schema.ts removed: both tables
  // have a different schema and live in cache.db (cache-service.ts), not in
  // panopticon.db. The CREATE TABLE IF NOT EXISTS stubs in schema.ts were orphaned
  // — the columns don't match and nothing reads them from getDatabase().
  { surface: 'schema: api_cache (panopticon.db)',        kind: 'cli', disposition: 'DELETE',       door: 'orphaned table stub in schema.ts; real api_cache lives in cache.db with different schema (cache-service.ts)' },
  { surface: 'schema: rate_limits (panopticon.db)',      kind: 'cli', disposition: 'DELETE',       door: 'orphaned table stub in schema.ts; real rate_limits lives in cache.db with different schema (cache-service.ts)' },

  // scripts/create-overdeck-db.ts and scripts/drizzle-node-sqlite-smoke.ts exempted
  // from the overdeck boundary lint. These are intentional dev/setup tools that
  // legitimately import the DB driver directly — they create and smoke-test
  // overdeck.db itself, so they cannot go through a domain door by definition.
  { surface: 'script: create-overdeck-db.ts (lint-exempt)',         kind: 'cli', disposition: 'OUT_OF_SCOPE', door: 'intentional infra: creates overdeck.db schema; must reach driver directly; not a production caller' },
  { surface: 'script: drizzle-node-sqlite-smoke.ts (lint-exempt)',  kind: 'cli', disposition: 'OUT_OF_SCOPE', door: 'intentional infra: smoke-tests overdeck.db driver; must reach driver directly; not a production caller' },

  // PAN-1866: backlog sequence routes
  { surface: 'GET /api/backlog/sequence',                  kind: 'http', disposition: 'READ',       door: 'backlog route reads backlog_sequence cache + parseSequenceMd fallback; server-side inPipeline join via getReviewStatusSync (PAN-1866)' },
  { surface: 'GET /api/backlog/issue-state',               kind: 'http', disposition: 'READ',       door: 'backlog route reads single-issue pickup state from backlog classifier (same source as /sequence) + getReviewStatusSync join (PAN-2059)' },
  { surface: 'POST /api/backlog/sequence/regenerate',      kind: 'http', disposition: 'WRITE',      door: 'backlog route spawns sequencer agent via spawnSequencerAgent (PAN-1866)' },
  { surface: 'POST /api/backlog/sequence/gate',            kind: 'http', disposition: 'WRITE',      door: 'backlog route writes operator gate field to sequence.md via writeSequenceMd; applies parked label when gate=blocked (PAN-1866)' },
  { surface: 'POST /api/backlog/sequence/planning',        kind: 'http', disposition: 'WRITE',      door: 'backlog route writes operator planning field to sequence.md via writeSequenceMd (PAN-1866)' },
  // PAN-2005/PAN-2006: pickup forecast + editor-label routes (shared pickup module)
  { surface: 'GET /api/backlog/forecast',                  kind: 'http', disposition: 'AGGREGATE',  door: 'backlog route computes the pickup forecast (waves/lanes/cohort/stats) from the shared src/lib/backlog/pickup.ts module via buildClassifyLookups (PAN-2005)' },
  { surface: 'POST /api/backlog/sequence/labels',          kind: 'http', disposition: 'WRITE',      door: 'backlog route toggles ready/parked/blocks-main labels via label-ops editor write-door (PAN-2006)' },
  { surface: 'POST /api/backlog/sequence/clear',           kind: 'http', disposition: 'DELETE',     door: 'backlog route deletes sequence.md + clears the disposable backlog_sequence cache via clearBacklogSequence (PAN-2005)' },
  { surface: 'GET /api/backlog/sequencer-status',          kind: 'http', disposition: 'READ',       door: 'backlog route reports live sequencer pass progress (running/total/processed) from listRunningAgentsSync + manifest + transcript (PAN-2005)' },

  // PAN-2377: operator order-book routes (canonical orders read/write doors)
  { surface: 'GET /api/orders/backlog-candidates',         kind: 'http', disposition: 'AGGREGATE',  door: 'OrdersResolver.list membership joined with the backlog candidate resolver' },
  { surface: 'GET /api/orders',                            kind: 'http', disposition: 'READ',       door: 'OrdersResolver.list' },
  { surface: 'POST /api/orders',                           kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.create' },
  { surface: 'GET /api/orders/:id',                        kind: 'http', disposition: 'READ',       door: 'OrdersResolver.get' },
  { surface: 'PATCH /api/orders/:id',                      kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.update' },
  { surface: 'POST /api/orders/:id/items',                 kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.addItem' },
  { surface: 'DELETE /api/orders/:id/items/:issue',        kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.removeItem' },
  { surface: 'PATCH /api/orders/:id/items/:issue',         kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.updateItem' },
  { surface: 'POST /api/orders/:id/start',                 kind: 'http', disposition: 'WRITE',      door: 'OrdersWriter.start' },
  { surface: 'GET /api/orders/:id/preview-brief',          kind: 'http', disposition: 'READ',       door: 'OrdersResolver.previewBrief' },

  // Pre-existing routes discovered during PAN-1866 audit (were missing from matrix)
  { surface: 'POST /api/agents/:id/restart-fresh',         kind: 'http', disposition: 'WRITE',      door: 'agents route wipes work-agent state and re-spawns on new harness/model; deliberate operator override for harness switch' },
  { surface: 'POST /api/review/:issueId/purge',            kind: 'http', disposition: 'WRITE',      door: 'workspaces route purges all review agents for an issue and resets review status' },
  { surface: 'GET /api/projects/:projectKey/swarm-policy', kind: 'http', disposition: 'READ',       door: 'Project config resolver reads the configured project-level swarm policy' },
  { surface: 'POST /api/projects/:projectKey/swarm-policy', kind: 'http', disposition: 'WRITE',     door: 'Project config writer sets the project-level swarm policy' },
  { surface: 'GET /api/issues/:issueId/swarm-policy',      kind: 'http', disposition: 'READ',       door: 'Issue record resolver reads and resolves the issue-level swarm policy' },
  { surface: 'POST /api/issues/:issueId/swarm-policy',     kind: 'http', disposition: 'WRITE',      door: 'Issue record writer sets the issue-level swarm policy' },
];

/** PAN-2648 Beads-removal surface lock. */
export type BeadsRemovalDisposition = 'RETAIN_AS_TASK' | 'DELETE';

export interface BeadsRemovalMatrixEntry {
  surface: string;
  disposition: BeadsRemovalDisposition;
  /** Concrete replacement for retained behavior, or the reason for deletion. */
  target: string;
}

export const BEADS_REMOVAL_NO_LOSS_MATRIX: BeadsRemovalMatrixEntry[] = [
  { surface: 'bd ready / Beads ready query', disposition: 'RETAIN_AS_TASK', target: 'pan task next; getDispatchableItems()' },
  { surface: 'pan beads claim', disposition: 'RETAIN_AS_TASK', target: 'pan task claim with ownership and transition guards' },
  { surface: 'pan beads close', disposition: 'RETAIN_AS_TASK', target: 'pan task done, restricted to the claim owner' },
  { surface: 'pan beads update --status blocked/in_progress/open', disposition: 'RETAIN_AS_TASK', target: 'pan task block/claim/unblock' },
  { surface: 'bd update --claim atomic claim semantics', disposition: 'RETAIN_AS_TASK', target: 'Record fs-lock, task transition matrix, and owned claims' },
  { surface: 'pan beads create/delete/dep', disposition: 'DELETE', target: 'Planning owns immutable checklist structure' },
  { surface: 'pan beads sweep/compact/stats/upgrade/doctor/reconcile', disposition: 'DELETE', target: 'The Beads runtime store is removed' },
  { surface: 'Per-bead commit/push invariant', disposition: 'RETAIN_AS_TASK', target: 'One pushed commit per xBRIEF item' },
  { surface: 'Conditional per-bead inspection', disposition: 'RETAIN_AS_TASK', target: 'Item metadata and pan inspect --item' },
  { surface: 'Work prompt task list', disposition: 'RETAIN_AS_TASK', target: 'Merged xBRIEF items and active slice' },
  { surface: 'Crash recovery position', disposition: 'RETAIN_AS_TASK', target: 'Merged statuses, owned claims, record resume hazards, and stale-claim patrol' },
  { surface: 'Start has-beads gate', disposition: 'RETAIN_AS_TASK', target: 'Readable implementation-ready xBRIEF gate' },
  { surface: 'pan done open-beads gate', disposition: 'RETAIN_AS_TASK', target: 'Non-terminal xBRIEF item and acceptance-criteria gate' },
  { surface: 'Idle open-beads nudge', disposition: 'RETAIN_AS_TASK', target: 'getDispatchableItems() result' },
  { surface: 'Stuck-remediation ready-beads gate', disposition: 'RETAIN_AS_TASK', target: 'Merged-xBRIEF readiness' },
  { surface: 'Orphaned completion all-beads-closed gate', disposition: 'RETAIN_AS_TASK', target: 'All xBRIEF checklist items terminal' },
  { surface: 'Backlog/flywheel issuesWithBeads readiness', disposition: 'RETAIN_AS_TASK', target: 'Planned or implementation-ready spec presence' },
  { surface: 'Dashboard /beads list', disposition: 'RETAIN_AS_TASK', target: '/tasks backed by the merged xBRIEF' },
  { surface: 'Beads rail/tab/dialog/kanban', disposition: 'RETAIN_AS_TASK', target: 'Tasks UX backed by xBRIEF data' },
  { surface: 'Beads rollup/freshness/sync services and events', disposition: 'DELETE', target: 'The local merged xBRIEF view needs no freshness layer' },
  { surface: 'Resource hasBeads, beadTotals, beadsPath', disposition: 'RETAIN_AS_TASK', target: 'hasTasks and taskTotals; the path/source signal is deleted' },
  { surface: 'Install/prerequisite bd checks', disposition: 'DELETE', target: 'The bd executable is no longer a prerequisite' },
  { surface: 'Workspace .beads/redirect creation/copy', disposition: 'DELETE', target: 'The Beads canonical-home redirect is no longer used' },
  { surface: 'State migration Beads cutover marker/layout checks', disposition: 'DELETE', target: 'The Beads state layout is no longer used' },
  { surface: 'Teardown export, restore, auto-commit, remote sync', disposition: 'DELETE', target: 'There is no derived Beads state to synchronize' },
  { surface: 'Beads skills, rules, and AGENTS template section', disposition: 'DELETE', target: 'The task loop moves to work-agent instructions' },
  { surface: 'docs/BEADS.md and configuration/beads.mdx', disposition: 'DELETE', target: 'xBRIEF and task documentation replaces live Beads documentation' },
  { surface: 'record.beadsMapping field', disposition: 'DELETE', target: 'New records omit it; readers tolerate the legacy field' },
];

/** PAN-2647 system-health surface lock. */
export type HealthNoLossDisposition = 'V2_HOME' | 'SUPERSEDED';

export interface HealthNoLossMatrixEntry {
  surface: string;
  disposition: HealthNoLossDisposition;
  /** Concrete V2 home, or the explicit reason for supersession. */
  target: string;
}

export const HEALTH_NO_LOSS_MATRIX: HealthNoLossMatrixEntry[] = [
  { surface: 'Header health pill metric', disposition: 'V2_HOME', target: 'SystemHealthPill state-specific trigger copy from SystemHealthSnapshot.state and admission evidence' },
  { surface: 'CPU and load', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.host.metrics.cpuPercent and loadPerCore1m in SystemHealthPill' },
  { surface: 'Memory totals', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.host.metrics usedMemoryBytes, totalMemoryBytes, and availableMemoryBytes in SystemHealthPill' },
  { surface: 'Swap fields', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.host.metrics swap occupancy shown as diagnostic context in SystemHealthPill' },
  { surface: 'Committed-memory diagnostic', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.host.metrics virtualCommitmentPercent shown as Overcommit diagnostic in SystemHealthPill' },
  { surface: 'Memory attributions', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.summary overdeckMemoryBytes and overdeckMemoryPercent in SystemHealthPill' },
  { surface: 'Role counts', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.summary role counts, admission admittedWorkAgentCount, and HealthDashboard status summary cards' },
  { surface: 'Webhook state', disposition: 'V2_HOME', target: 'SystemHealthSnapshot.services webhook-relay entry with legacy summary fallback in SystemHealthPill' },
  { surface: 'Kill action', disposition: 'V2_HOME', target: 'SystemHealthConsumer.killTarget agent and specialist actions through useKillAgent or the specialist kill endpoint' },
  { surface: 'Remove action', disposition: 'V2_HOME', target: 'SystemHealthConsumer.killTarget container action through DELETE /api/resources/docker/container/:id' },
  { surface: 'Leaked-focus supersession', disposition: 'SUPERSEDED', target: 'Critical transitions focus leaked consumers first; Show all restores the complete top-consumer list' },
  { surface: 'Transition event', disposition: 'V2_HOME', target: 'SystemHealthPill emits one operator-facing toast when accepted health transitions to critical' },
  { surface: 'Stale-build chip', disposition: 'V2_HOME', target: 'StaleBuildChip reads DeployStalenessSnapshot through useDeployStaleness and GET /api/deploy/staleness, outside the health contract' },
  { surface: 'GET /api/system/health', disposition: 'V2_HOME', target: 'Accepted SystemHealthSnapshot V2 compatibility route from getAcceptedSystemHealthSnapshot()' },
  { surface: 'GET /api/godview/system-health', disposition: 'V2_HOME', target: 'Accepted SystemHealthSnapshot V2 plus retained Godview scalar projections for one compatibility cycle' },
  { surface: 'GET /api/health/agents', disposition: 'V2_HOME', target: 'AgentHealthSnapshot[] projection from the canonical read model and live tmux liveness' },
  { surface: 'Resources host vitals', disposition: 'V2_HOME', target: 'GET /api/resources hostVitals projected from accepted SystemHealthSnapshot.host metrics' },
  { surface: 'Spawn gate', disposition: 'V2_HOME', target: 'GET /api/resources spawnGate projected from accepted admission evidence and enforcement decision' },
  { surface: 'Capacity guardrail', disposition: 'V2_HOME', target: 'mapSpawnGateDecision preserves blocking enforcement decisions while attaching accepted health evidence' },
  { surface: 'Summary cards', disposition: 'V2_HOME', target: 'HealthDashboard renders all accepted AgentHealthStatus counts with accessible names' },
  { surface: 'Deacon section', disposition: 'V2_HOME', target: 'HealthDashboard DeaconStatus remains visible while loading, unavailable, or agent-empty' },
  { surface: 'TLDR section', disposition: 'V2_HOME', target: 'HealthDashboard TldrServiceStatus distinguishes optional unconfigured from request unavailable' },
  { surface: 'pan doctor', disposition: 'V2_HOME', target: 'Independent dependency, installation, state-worktree, and system diagnostic command; it is not a live V2 snapshot view' },
];
