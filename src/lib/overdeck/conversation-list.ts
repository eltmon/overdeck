import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';

import { Effect } from 'effect';

import { scanPendingInputsPromise, type PendingAskUserQuestionSnapshot, type PendingInputKind } from '../agent-enrichment.js';
import { getAgentRuntimeStateSync } from '../agents.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { isHarnessProcessAlive, listSessionNames } from '../tmux.js';
import { resolveConversationGitInfo } from '../../dashboard/server/services/git-info.js';
import { isCompacting } from '../../dashboard/server/services/conversation-compaction.js';
import { summarizeConversationActivity } from '../../dashboard/server/services/conversation-service.js';
import {
  conversationNeedsRunningRepair,
  conversationSessionAliveFromState,
} from './conversation-runtime.js';
import { codexConversationPendingInput } from './conversation-delivery.js';
import {
  getConversationLedgerCosts,
  listConversations,
  listFavoritedIds,
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
  const ledgerCosts = getConversationLedgerCosts();
  const liveSessionNames = new Set(await Effect.runPromise(listSessionNames()));
  return Effect.runPromise(withConcurrencyLimit(
    conversations.map((conv) => Effect.promise(async () => {
      let row = conv;
      const tmuxSessionAlive = liveSessionNames.has(conv.tmuxSession);
      let sessionAlive = conversationSessionAliveFromState(row, tmuxSessionAlive);
      if (!sessionAlive && row.status === 'ended' && !row.forkStatus && tmuxSessionAlive) {
        const harnessAlive = await isHarnessProcessAlive(row.tmuxSession);
        if (conversationNeedsRunningRepair(row, tmuxSessionAlive, harnessAlive)) {
          markConversationRunning(row.name);
          row = { ...row, status: 'active', endedAt: null };
          sessionAlive = true;
        }
      }
      let isWorking = false;
      let currentTool: string | null = null;
      const convSf = await resolveSessionFile(row);
      if (sessionAlive) {
        const rt = getAgentRuntimeStateSync(row.tmuxSession);
        if (getHarnessBehavior(row.harness).transcriptKind === 'codex-rollout-jsonl' && convSf && existsSync(convSf)) {
          try {
            const summary = await summarizeConversationActivity(convSf, { harness: row.harness });
            isWorking = summary.isWorking;
            currentTool = summary.currentTool;
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
          const scan = await scanPendingInputsPromise(convSf);
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
        isFavorited: favoritedNames.has(row.name),
        compacting,
        contextUsage: null,
        lastActivityAt,
        branch: gitInfo.branch,
        isWorktree: gitInfo.isWorktree,
        pendingInputCount,
        pendingInputKinds,
        pendingAskUserQuestion,
        transcriptMissing: conversationTranscriptMissing(row, sessionAlive, convSf),
        needsTerminal: await conversationNeedsTerminal(row, sessionAlive, convSf),
      };
    })),
    CONVERSATION_LIST_ENRICHMENT_CONCURRENCY,
  ));
}
