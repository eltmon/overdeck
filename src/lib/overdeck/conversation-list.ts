import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';

import { resolveEffectivePullRequest } from '@overdeck/contracts';

import { scanPendingInputs, type PendingAskUserQuestionSnapshot, type PendingInputKind } from '../agent-enrichment.js';
import { getAgentRuntimeStateSync } from '../agents.js';
import { latestWorkerReport, type WorkerReport } from '../agents/worker/report.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { laneIterations } from '../lanes/iteration.js';
import { pairBuilder, type PairingRow, type VerdictState } from '../lanes/pairing.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { conversationHarnessAlive, listLiveConversationSessions } from './conversation-liveness.js';
import { resolveConversationGitInfo } from '../../dashboard/server/services/git-info.js';
import { isCompacting } from '../../dashboard/server/services/conversation-compaction.js';
import { summarizeConversationActivity } from '../../dashboard/server/services/conversation-service.js';
import { getConversationLedgerCostsSnapshot } from '../../dashboard/server/services/dashboard-poll-snapshots.js';
import {
  conversationNeedsRunningRepair,
  conversationSessionAliveFromState,
} from './conversation-runtime.js';
import { codexConversationPendingInput } from './conversation-delivery.js';
import { listPullRequestLinksForConversations } from './conversation-pull-requests.js';
import {
  type LegacyConversation,
  listConversations,
  listFavoritedIds,
  listLaneConversations,
  markConversationRunning,
} from './conversations.js';
import {
  askUserQuestionSnapshotFromScan,
  conversationNeedsTerminal,
  conversationTranscriptMissing,
  resolveSessionFile,
} from './conversation-reads.js';

const CONVERSATION_LIST_ENRICHMENT_CONCURRENCY = 8;

const FAVORITES_CACHE_TTL_MS = 5000;
let favoritesCache: { timestamp: number; ids: Set<string> } | null = null;

function getCachedFavoritedIds(): Set<string> {
  const now = Date.now();
  if (favoritesCache && now - favoritesCache.timestamp < FAVORITES_CACHE_TTL_MS) {
    return favoritesCache.ids;
  }
  const ids = new Set(listFavoritedIds('conversation'));
  favoritesCache = { timestamp: now, ids };
  return ids;
}

export function invalidateConversationFavoritesCache(): void {
  favoritesCache = null;
}

// PAN-1705 — coalesce concurrent list enrichments. Several dashboard clients
// poll this endpoint on overlapping intervals; each request used to run its
// own full per-row enrichment (session-file resolution, stats, JSONL scans
// for alive sessions). Under machine load (verification gates) the
// overlapping enrichments queue-collapsed the event loop and pushed even
// trivial endpoints to 10s+. One enrichment per short window serves all
// concurrent pollers; <=2s staleness is invisible at the 4-10s poll cadence.
const LIST_ENRICHMENT_TTL_MS = 2_000;

interface ListEnrichmentEntry {
  settledAt: number | null;
  promise: Promise<readonly unknown[]>;
}

const listEnrichmentInFlight = new Map<string, ListEnrichmentEntry>();

// PAN-1577 — a move writes project_key and must not let the next
// GET /api/conversations serve an enrichment settled before the write.
export function invalidateConversationListEnrichmentCache(): void {
  listEnrichmentInFlight.clear();
}

/**
 * PAN-4223 WI-5, WI-20: a lane row's newest report, D7 iteration and critic
 * pairing. One lane query per run on the page (archived lanes count); no git
 * work. Non-lane rows get nothing.
 */
async function laneEnrichment(conversations: readonly LegacyConversation[]): Promise<Map<string, Record<string, unknown>>> {
  const enrichment = new Map<string, Record<string, unknown>>();
  const runs = [...new Set(conversations.filter((conv) => conv.laneKey && conv.gauntletRun).map((conv) => conv.gauntletRun as string))];
  if (runs.length === 0) return enrichment;
  const context = runs.flatMap((run) => listLaneConversations({ run }));
  const iterations = laneIterations(context);
  const reports = new Map<string, WorkerReport | null>();
  await withConcurrencyLimit(context.map((row) => async () => {
    reports.set(row.name, await latestWorkerReport(`conv-${row.name}`));
  }), CONVERSATION_LIST_ENRICHMENT_CONCURRENCY);
  const pairingRows = context.map((row): PairingRow => {
    const report = reports.get(row.name) ?? null;
    return {
      id: row.id,
      name: row.name,
      run: row.gauntletRun ?? '',
      key: row.laneKey ?? '',
      role: row.laneRole ?? 'builder',
      iteration: iterations.get(row.name) ?? 1,
      createdAt: row.createdAt,
      criticOfId: row.criticOfConversationId,
      activity: row.status,
      report: report ? { status: report.status, ...(report.verdict ? { verdict: report.verdict } : {}) } : null,
    };
  });
  const pairingByName = new Map(pairingRows.map((row) => [row.name, row]));
  for (const conv of conversations) {
    const pairing = pairingByName.get(conv.name);
    if (!conv.laneKey || !pairing) continue;
    const report = reports.get(conv.name) ?? null;
    const fields: Record<string, unknown> = {
      laneReport: report ? { seq: report.seq, at: report.at, status: report.status, verdict: report.verdict?.value ?? null } : null,
      laneIteration: pairing.iteration,
    };
    if (conv.laneRole === 'critic' || conv.laneRole === 'verifier') {
      const verdict = report?.status === 'done' ? report.verdict : undefined;
      fields.laneVerdict = { value: (verdict?.value ?? 'pending') as VerdictState, defects: verdict?.defects ?? null };
    } else if (conv.laneRole === 'builder') {
      const latest = pairBuilder(pairing, pairingRows).latestVerdict;
      fields.laneLatestVerdict = latest ? { value: latest.verdict, defects: latest.defects, criticId: latest.id } : null;
    }
    enrichment.set(conv.name, fields);
  }
  return enrichment;
}

export function getEnrichedConversationList(limit: number, offset: number): Promise<readonly unknown[]> {
  const key = `${limit}:${offset}`;
  const now = Date.now();
  const hit = listEnrichmentInFlight.get(key);
  if (hit && (hit.settledAt === null || now - hit.settledAt < LIST_ENRICHMENT_TTL_MS)) {
    return hit.promise;
  }
  const entry: ListEnrichmentEntry = {
    settledAt: null,
    promise: enrichConversationList(limit, offset),
  };
  listEnrichmentInFlight.set(key, entry);
  entry.promise
    .then(() => { entry.settledAt = Date.now(); })
    .catch(() => {
      if (listEnrichmentInFlight.get(key) === entry) listEnrichmentInFlight.delete(key);
    });
  for (const [k, v] of listEnrichmentInFlight) {
    if (k !== key && v.settledAt !== null && now - v.settledAt >= LIST_ENRICHMENT_TTL_MS) {
      listEnrichmentInFlight.delete(k);
    }
  }
  return entry.promise;
}

async function enrichConversationList(limit: number, offset: number): Promise<readonly unknown[]> {
  const conversations = listConversations({ limit, offset });
  const favoritedNames = getCachedFavoritedIds();
  const [ledgerEntries, liveSessionNames] = await Promise.all([
    getConversationLedgerCostsSnapshot(), listLiveConversationSessions(),
  ]);
  const ledgerCosts = new Map(ledgerEntries);
  // PAN-3822: one query for the whole page's PR links, never one per row.
  const pullRequestLinks = listPullRequestLinksForConversations(conversations.map((conv) => conv.name));
  const lanes = await laneEnrichment(conversations);
  return withConcurrencyLimit(
    conversations.map((conv) => async () => {
      let row = conv;
      // Null: the backend did not answer, so liveness is unknown — keep the
      // row's stored status and repair nothing (PAN-3921).
      const tmuxSessionAlive = liveSessionNames ? liveSessionNames.has(conv.tmuxSession) : row.status === 'active';
      let sessionAlive = conversationSessionAliveFromState(row, tmuxSessionAlive);
      if (liveSessionNames && !sessionAlive && row.status === 'ended' && !row.forkStatus && tmuxSessionAlive) {
        const harnessAlive = await conversationHarnessAlive(row.tmuxSession);
        if (conversationNeedsRunningRepair(row, tmuxSessionAlive, harnessAlive)) {
          markConversationRunning(row.name);
          row = { ...row, status: 'active', endedAt: null };
          sessionAlive = true;
        }
      }
      let isWorking = false;
      let currentTool: string | null = null;
      let stalledSince: string | undefined;
      const convSf = await resolveSessionFile(row);
      if (sessionAlive) {
        const rt = getAgentRuntimeStateSync(row.tmuxSession);
        const transcriptKind = getHarnessBehavior(row.harness).transcriptKind;
        if ((transcriptKind === 'codex-rollout-jsonl' || transcriptKind === 'acp-jsonl') && convSf && existsSync(convSf)) {
          try {
            const summary = await summarizeConversationActivity(convSf, { harness: row.harness });
            isWorking = summary.isWorking;
            currentTool = summary.currentTool;
            stalledSince = summary.stalledSince;
          } catch {
            if (rt && rt.state !== 'uninitialized') {
              isWorking = rt.state === 'active';
              currentTool = rt.currentTool ?? null;
            }
          }
        } else if (rt && rt.state !== 'uninitialized') {
          isWorking = rt.state === 'active';
          currentTool = rt.currentTool ?? null;
        } else if (convSf && existsSync(convSf)) {
          try {
            const summary = await summarizeConversationActivity(convSf, { harness: row.harness });
            isWorking = summary.isWorking;
            currentTool = summary.currentTool;
          } catch {
            // JSONL parse failure — fall back to defaults
          }
        }
      }
      let pendingInputCount = 0;
      let pendingInputKinds: PendingInputKind[] = [];
      let pendingAskUserQuestion: PendingAskUserQuestionSnapshot | undefined;
      if (sessionAlive && convSf && existsSync(convSf)) {
        try {
          const scan = await scanPendingInputs(convSf);
          const kinds: PendingInputKind[] = [];
          const auqSnapshot = askUserQuestionSnapshotFromScan(scan);
          if (auqSnapshot) {
            kinds.push('askUserQuestion');
            pendingAskUserQuestion = auqSnapshot;
          }
          if (scan.exitPlanModePending) kinds.push('exitPlanMode');
          if (scan.enterPlanModeOpen && !scan.exitPlanModePending) kinds.push('enterPlanMode');
          pendingInputKinds = kinds;
          pendingInputCount = kinds.length;
        } catch {
          // JSONL scan failure — leave as zero/empty; non-fatal
        }
      }
      const compacting = convSf ? isCompacting(convSf) : false;
      const gitInfo = await resolveConversationGitInfo(row.cwd);
      let lastActivityAt: string | null = null;
      if (convSf && existsSync(convSf)) {
        try {
          lastActivityAt = new Date((await stat(convSf)).mtimeMs).toISOString();
        } catch {
          // non-fatal — fall back to lastAttachedAt/createdAt downstream
        }
      }
      if (pendingInputCount === 0) {
        const codex = await codexConversationPendingInput(
          row,
          sessionAlive,
          lastActivityAt ?? new Date().toISOString(),
        );
        if (codex.kinds.length > 0) {
          pendingInputKinds = codex.kinds;
          pendingInputCount = codex.kinds.length;
          if (codex.approval) pendingAskUserQuestion = codex.approval;
        }
      }
      const ledger = ledgerCosts.get(String(row.id));
      return {
        ...row,
        totalCost: ledger ? ledger.cost : row.totalCost,
        totalTokens: ledger ? ledger.tokens : row.totalTokens,
        sessionAlive,
        isWorking,
        currentTool,
        stalledSince,
        isFavorited: favoritedNames.has(row.name),
        compacting,
        contextUsage: null,
        lastActivityAt,
        branch: gitInfo.branch,
        isWorktree: gitInfo.isWorktree,
        pullRequest: resolveEffectivePullRequest(pullRequestLinks.get(row.name) ?? []),
        pullRequestCount: (pullRequestLinks.get(row.name) ?? []).filter((link) => link.dismissedAt === null).length,
        pendingInputCount,
        pendingInputKinds,
        pendingAskUserQuestion,
        transcriptMissing: conversationTranscriptMissing(row, sessionAlive, convSf),
        needsTerminal: await conversationNeedsTerminal(row, sessionAlive, convSf),
        ...(lanes.get(row.name) ?? {}),
      };
    }),
    CONVERSATION_LIST_ENRICHMENT_CONCURRENCY,
  );
}
