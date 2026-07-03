import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getAgentHealth } from '../../../../lib/cloister/health.js';
import { performHandoff } from '../../../../lib/cloister/handoff.js';
import { loadCloisterConfigSync } from '../../../../lib/cloister/config.js';
import { getCloisterService } from '../../../../lib/cloister/service.js';
import { checkAllTriggers } from '../../../../lib/cloister/triggers.js';
import { calculateCostSync, getPricingSync, type TokenUsage } from '../../../../lib/cost.js';
import { normalizeModelName } from '../../../../lib/cost-parsers/jsonl-parser.js';
import { requireModelOverrideSync } from '../../../../lib/model-validation.js';
import { encodeClaudeProjectDir } from '../../../../lib/paths.js';
import { getRuntimeForAgent } from '../../../../lib/runtimes/index.js';
import {
  getAgentState,
  setAgentDeliveryMethod,
} from '../../../../lib/agents.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { validateOrigin } from '../origin-validation.js';
import { readJsonBody } from './shared.js';

// ─── Route: GET /api/agents/:id/cloister-health ──────────────────────────────

export const getAgentCloisterHealthRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cloister-health',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const service = getCloisterService();
    const health = service.getAgentHealth(id);
    if (!health) {
      return jsonResponse({ error: 'Agent not found or runtime not available' }, { status: 404 });
    }
    return jsonResponse(health);
  })),
);

// ─── Route: GET /api/agents/:id/handoff/suggestion ───────────────────────────

export const getAgentHandoffSuggestionRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/handoff/suggestion',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    const runtime = getRuntimeForAgent(id);
    if (!runtime) {
      return jsonResponse({ error: 'Runtime not found for agent' }, { status: 404 });
    }

    const health = getAgentHealth(id, runtime);
    const triggers = yield* checkAllTriggers(
      id,
      agentState.workspace,
      agentState.issueId,
      agentState.model,
      health,
      loadCloisterConfigSync()
    );

    if (triggers.length > 0) {
      const trigger = triggers[0];
      return jsonResponse({
        suggested: true,
        trigger: trigger.type,
        currentModel: agentState.model,
        suggestedModel: trigger.suggestedModel,
        reason: trigger.reason,
      });
    }

    return jsonResponse({
      suggested: false,
      trigger: null,
      currentModel: agentState.model,
      suggestedModel: null,
      reason: 'No handoff triggers detected',
    });
  })),
);

// ─── Route: POST /api/agents/:id/handoff ─────────────────────────────────────

export const postAgentHandoffRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/handoff',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;

    const { toModel, reason } = body as any;
    let targetModel: string;
    try {
      targetModel = requireModelOverrideSync(toModel);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }

    const result = yield* performHandoff(id, {
      targetModel,
      reason: reason || 'Manual handoff from dashboard',
    });

    if (result.success) {
      return jsonResponse({
        success: true,
        newAgentId: result.newAgentId,
        newSessionId: result.newSessionId,
      });
    } else {
      return jsonResponse({ success: false, error: result.error }, { status: 500 });
    }
  })),
);


// ─── Route: GET /api/agents/:id/cost ─────────────────────────────────────────

export const getAgentCostRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/cost',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: 'Agent not found' }, { status: 404 });
    }

    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let detectedModel = agentState.model || '';
    // Claude Code repeats the same `usage` on every JSONL line of one API response
    // (text line, each tool_use line, …). Dedup on requestId/message.id so a multi-block
    // turn is counted once instead of inflating tokens/cost ~2-3×.
    const countedUsageIds = new Set<string>();

    const homeDir = process.env.HOME || homedir();
    const claudeProjectsDir = join(homeDir, '.claude', 'projects');
    const workspacePath = agentState.workspace;

    if (workspacePath) {
      const projectDirName = encodeClaudeProjectDir(workspacePath);
      const projectDir = join(claudeProjectsDir, projectDirName);
      const sessionsIndexPath = join(projectDir, 'sessions-index.json');

      const parseJsonlCost = async (filePath: string) => {
        const jsonlContent = await readFile(filePath, 'utf-8');
        const lines = jsonlContent.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const usage = entry.message?.usage || entry.usage;
            const model = entry.message?.model || entry.model;
            const usageId = entry.requestId ?? entry.message?.id;
            if (usage && (usageId === undefined || !countedUsageIds.has(usageId))) {
              if (usageId !== undefined) countedUsageIds.add(usageId);
              inputTokens += usage.input_tokens || 0;
              outputTokens += usage.output_tokens || 0;
              cacheReadTokens += usage.cache_read_input_tokens || 0;
              cacheWriteTokens += usage.cache_creation_input_tokens || 0;
            }
            if (model && !detectedModel) {
              detectedModel = model;
            }
          } catch {}
        }
      };

      if (existsSync(sessionsIndexPath)) {
        try {
          const indexContent = JSON.parse(yield* Effect.promise(() => readFile(sessionsIndexPath, 'utf-8')));
          for (const sessionEntry of (indexContent.entries || [])) {
            if (sessionEntry?.fullPath && existsSync(sessionEntry.fullPath)) {
              yield* Effect.promise(() => parseJsonlCost(sessionEntry.fullPath));
            }
          }
        } catch {}
      }

      if (inputTokens === 0 && existsSync(projectDir)) {
        try {
          const files = (yield* Effect.promise(() => readdir(projectDir))).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            yield* Effect.promise(() => parseJsonlCost(join(projectDir, file)));
          }
        } catch {}
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      const modelInfo = normalizeModelName(detectedModel || 'claude-sonnet-4');
      const pricing = getPricingSync(modelInfo.provider, modelInfo.model);
      if (pricing) {
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        cost = calculateCostSync(usage, pricing);
      }
    }

    return jsonResponse({
      agentId: id,
      model: detectedModel || agentState.model,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
      },
      cost,
    });
  })),
);

// ─── Route: POST /api/agents/:id/delivery-method ─────────────────────────────
// Updates the agent's delivery method (auto | channels | tmux) in state.json.

export function validateAgentDeliveryMethodOrigin(
  request: HttpServerRequest.HttpServerRequest,
): { ok: true } | { ok: false; status: 403; body: { error: 'forbidden' } } {
  const originCheck = validateOrigin(request);
  if (originCheck.ok) return { ok: true };
  return { ok: false, status: 403, body: { error: 'forbidden' } };
}

export const postAgentDeliveryMethodRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/delivery-method',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originDecision = validateAgentDeliveryMethodOrigin(request);
    if (!originDecision.ok) {
      return jsonResponse(originDecision.body, { status: originDecision.status });
    }

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const body = yield* readJsonBody;
    const { deliveryMethod } = body as { deliveryMethod?: 'auto' | 'channels' | 'tmux' };

    if (!deliveryMethod || !['auto', 'channels', 'tmux'].includes(deliveryMethod)) {
      return jsonResponse({ error: 'deliveryMethod must be auto, channels, or tmux' }, { status: 400 });
    }

    const agentState = yield* getAgentState(id);
    if (!agentState) {
      return jsonResponse({ error: `Agent ${id} not found` }, { status: 404 });
    }

    yield* Effect.promise(() => setAgentDeliveryMethod(id, deliveryMethod));
    return jsonResponse({ success: true, agentId: id, deliveryMethod });
  })),
);

// ─── Route: POST /api/agents/:id/switch-model ────────────────────────────────
// Pipeline agent models are fixed at spawn. Changing a model tears down the
// live session and discards context, so this route is retained only as a
// server-side compatibility rejection for older clients.

export const postAgentSwitchModelRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/switch-model',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    return jsonResponse({
      error: `Agent ${id} model is locked once the agent is spawned`,
    }, { status: 409 });
  })),
);
