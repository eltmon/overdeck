/**
 * PAN-5465 WI-4: add pack skills to a conversation and apply them.
 *
 * `applyConversationSkills` merges a request into the `/clear` chain head's
 * skill map (D-1 add-only plus explicit off, D-11), then applies it:
 * `next-launch` for a stopped conversation (FR-5), a hot apply for a running
 * Claude Code one (FR-3, conversation-skill-hot-apply.ts), and
 * `needs-restart` / `restarted` (a resume apply) for Codex, native skills and
 * changes a hot apply cannot make (FR-4, D-6, D-8). Validation happens before
 * any write (D-13); a hot-apply refusal stores nothing (NFR-3). One apply runs
 * at a time per terminal session (NFR-5).
 *
 * `readConversationSkills` answers FR-7 for the dashboard dialog. Every effect
 * is injectable through `SkillApplyDeps`.
 */
import { getHarnessBehavior } from '@overdeck/contracts';
import type { LivenessVerdict } from '../agents/liveness.js';
import type { PackCatalogEntry, SkillCatalogEntry } from '../skill-overrides/catalog.js';
import {
  ConversationSkillFlagError,
  expandConversationSkillFlags,
  parseSkillFlagList,
} from '../skill-overrides/conversation-flags.js';
import { skillPackLinkPath } from '../skill-overrides/launcher-lines.js';
import { isCoreSkill, isPackSkillId } from '../skill-overrides/resolve.js';
import { SHUTDOWN_REFUSAL, isShutdownDrainingSync } from '../shutdown/drain-record.js';
import { isSupersededConversation, resolveClearChainHead } from './conversation-clear-chain.js';
import { conversationWriteRefusalBody } from './conversation-release.js';
import type { hotApplyPrecheck, hotApplyRun } from './conversation-skill-hot-apply.js';
import { getConversationByName, setConversationSkillOverrides, type LegacyConversation } from './conversations.js';

export type SkillApplyOutcome = 'hot' | 'sent' | 'queued' | 'needs-restart' | 'restarted' | 'next-launch';

export interface SkillApplyRequest {
  skills: string[];
  packs: string[];
  off: string[];
  restart: boolean;
}

export type SkillApplyErrorBody = { error: string; code?: string };
export type SkillApplySuccessBody = { outcome: SkillApplyOutcome; added: string[]; warnings: string[] };

export interface SkillApplyResponse {
  status: number;
  body: SkillApplySuccessBody | SkillApplyErrorBody;
}

export interface ConversationSkillsBody {
  conversation: string;
  harness: string;
  running: boolean;
  skillOverrides: Record<string, boolean>;
}

export interface SkillApplyDeps {
  getConversationByName: (name: string) => LegacyConversation | null;
  /** The `/clear` chain head of a superseded row (D-11); null when the continuation is gone. */
  resolveChainHead: (conv: LegacyConversation) => LegacyConversation | null;
  setConversationSkillOverrides: (name: string, overrides: Record<string, boolean> | null) => void;
  isAlive: (session: string) => Promise<LivenessVerdict>;
  isShutdownDraining: () => boolean;
  listCatalog: (projectRoot?: string) => Promise<{ skills: SkillCatalogEntry[]; packs: PackCatalogEntry[] }>;
  hotApplyPrecheck: typeof hotApplyPrecheck;
  hotApplyRun: typeof hotApplyRun;
  /** Stop the harness and resume the same conversation (as native compaction does); returns the resume status. */
  resumeApply: (head: LegacyConversation) => Promise<number>;
}

export const NOTHING_TO_ADD = 'Nothing to add';
export const SELF_RESTART_REFUSAL = 'A conversation cannot restart itself; ask the operator or call add_skills from another conversation';
export const HARNESS_REFUSAL = 'Skill packs apply only to Claude Code and Codex conversations';
export const APPLY_IN_PROGRESS = 'Another skill change is being applied to this conversation';
export const INDETERMINATE_WARNING = 'Could not tell whether the conversation is running.';
export const NO_PLUGIN_DIR_WARNING = 'This conversation started before live skill loading; it must restart once.';

const defaultDeps: SkillApplyDeps = {
  getConversationByName,
  resolveChainHead: (conv) => resolveClearChainHead(conv),
  setConversationSkillOverrides,
  isAlive: async (session) => {
    const { isAlive } = await import('../agents/liveness.js');
    return isAlive(session);
  },
  isShutdownDraining: isShutdownDrainingSync,
  listCatalog: async (projectRoot) => {
    const { listPackCatalog, listSkillCatalog } = await import('../skill-overrides/catalog.js');
    const [skills, packs] = await Promise.all([listSkillCatalog({ projectRoot }), listPackCatalog()]);
    return { skills, packs };
  },
  hotApplyPrecheck: async (...args) => (await import('./conversation-skill-hot-apply.js')).hotApplyPrecheck(...args),
  hotApplyRun: async (...args) => (await import('./conversation-skill-hot-apply.js')).hotApplyRun(...args),
  resumeApply: async (head) => {
    // Loaded lazily, as conversation-message.ts does, so this module does not pull the runtime launch graph.
    const [{ handleConversationResume, stopConversationRuntime }, { resolveSessionFile }] = await Promise.all([
      import('./conversation-runtime.js'),
      import('./conversation-reads.js'),
    ]);
    await stopConversationRuntime(head, head.name);
    const resumed = await handleConversationResume(head.name, { sendResumeContract: false }, {
      resolveSessionFile,
      resumeCause: 'system',
    });
    return resumed.status;
  },
};

function resolveDeps(deps: Partial<SkillApplyDeps> = {}): SkillApplyDeps {
  return { ...defaultDeps, ...deps };
}

/** Body → request; throws ConversationSkillFlagError for a malformed body (the route answers 400). */
export function parseSkillApplyBody(body: Record<string, unknown>): SkillApplyRequest {
  if (body['groups'] !== undefined) throw new ConversationSkillFlagError('Pack groups are not supported yet'); // D-10
  const skills = parseSkillFlagList(body['skills'], 'skills');
  const packs = parseSkillFlagList(body['packs'], 'packs');
  let off: string[];
  try {
    off = parseSkillFlagList(body['off'], 'skills');
  } catch (error) {
    if (error instanceof ConversationSkillFlagError) throw new ConversationSkillFlagError('Invalid off');
    throw error;
  }
  const restart = body['restart'];
  if (restart !== undefined && typeof restart !== 'boolean') throw new ConversationSkillFlagError('Invalid restart');
  return { skills, packs, off, restart: restart === true };
}

function errorResponse(status: number, error: string, code?: string): SkillApplyResponse {
  return { status, body: code ? { error, code } : { error } };
}

/** D-11: the named row, or the chain head of a superseded `/clear` row. */
function resolveHead(name: string, deps: SkillApplyDeps): LegacyConversation | null {
  const row = deps.getConversationByName(name);
  if (!row) return null;
  return isSupersededConversation(row) ? deps.resolveChainHead(row) : row;
}

/** NFR-5: terminal sessions with an apply in flight (keyed on the chain head, so one `/clear` chain shares a lock). */
const inFlight = new Set<string>();

export async function applyConversationSkills(
  name: string,
  request: SkillApplyRequest,
  opts: { self: boolean },
  depsOverride?: Partial<SkillApplyDeps>,
): Promise<SkillApplyResponse> {
  // a. D-13 / FR-8.
  if (request.skills.length === 0 && request.packs.length === 0 && request.off.length === 0) {
    return errorResponse(400, NOTHING_TO_ADD);
  }
  if (opts.self && request.restart) return errorResponse(400, SELF_RESTART_REFUSAL);
  const deps = resolveDeps(depsOverride);

  // b. D-11: the chain head, then the write refusals.
  const head = resolveHead(name, deps);
  if (!head) return errorResponse(404, 'Conversation not found');
  const refusal = conversationWriteRefusalBody(head);
  if (refusal) return errorResponse(409, refusal.error, refusal.code);
  if (deps.isShutdownDraining()) return errorResponse(409, SHUTDOWN_REFUSAL, 'shutdown-draining');

  // c. NFR-5.
  const lockKey = head.tmuxSession;
  if (inFlight.has(lockKey)) return errorResponse(409, APPLY_IN_PROGRESS, 'apply-in-progress');
  inFlight.add(lockKey);
  try {
    return await applyToHead(head, request, opts, deps);
  } finally {
    inFlight.delete(lockKey);
  }
}

async function applyToHead(
  head: LegacyConversation,
  request: SkillApplyRequest,
  opts: { self: boolean },
  deps: SkillApplyDeps,
): Promise<SkillApplyResponse> {
  // d. FR-6: the harness declares how conversation packs load (Claude Code hot-reload, Codex restart), or that they don't.
  const skillApply = getHarnessBehavior(head.harness).capabilities.conversationSkillApply;
  if (skillApply === null) return errorResponse(409, HARNESS_REFUSAL);

  // e. Expand and validate against one catalog before anything is stored (D-13).
  let entries: Record<string, boolean>;
  let offEntries: Record<string, boolean>;
  try {
    const catalog = await deps.listCatalog(head.cwd);
    entries = expandConversationSkillFlags({ skills: request.skills, packs: request.packs }, catalog);
    offEntries = Object.fromEntries(
      Object.keys(expandConversationSkillFlags({ skills: request.off, packs: [] }, catalog)).map((id) => [id, false]),
    );
  } catch (error) {
    if (error instanceof ConversationSkillFlagError) return errorResponse(400, error.message);
    throw error;
  }
  const current = head.skillOverrides ?? {};
  const merged = { ...current, ...entries, ...offEntries };
  const added = Object.keys({ ...entries, ...offEntries }).filter((id) => current[id] !== merged[id]).sort();
  const write = () => deps.setConversationSkillOverrides(head.name, merged);
  const answer = (outcome: SkillApplyOutcome, warnings: string[] = []): SkillApplyResponse =>
    ({ status: 200, body: { outcome, added, warnings } });

  // f. D-12: never restart on a broken probe.
  const verdict = await deps.isAlive(head.tmuxSession);
  if (!verdict.alive) {
    write();
    if (verdict.reason === 'runtime-indeterminate') return answer('needs-restart', [INDETERMINATE_WARNING]);
    return answer('next-launch');
  }

  const restartOrAsk = async (warnings: string[] = []): Promise<SkillApplyResponse> => {
    write();
    if (!request.restart) return answer('needs-restart', warnings);
    const status = await deps.resumeApply(head);
    if (status !== 200) {
      return errorResponse(502, `The skills are saved, but the restart failed (status ${status}); resume the conversation to load them`);
    }
    return answer('restarted', warnings);
  };

  // g. D-1 / D-6: native skills and Codex load only at launch.
  const native = [...request.skills, ...request.off].some((id) => !isPackSkillId(id) && !isCoreSkill(id));
  if (native || skillApply === 'restart') return restartOrAsk();

  // h. Claude Code hot apply.
  const link = skillPackLinkPath({ managedStateKey: head.tmuxSession, spawnMode: 'conversation', workingDir: head.cwd });
  if (!link) return restartOrAsk([NO_PLUGIN_DIR_WARNING]);
  const precheck = await deps.hotApplyPrecheck(head, { link, conversationLayer: merged });
  if (precheck.kind === 'refused') return { status: precheck.status, body: precheck.body };
  if (precheck.kind === 'not-hot') {
    const warning = precheck.reason === 'launch-wired'
      ? `${(precheck.packs ?? []).join(', ')} need a restart to load.`
      : NO_PLUGIN_DIR_WARNING;
    return restartOrAsk([warning]);
  }
  write();
  const result = await deps.hotApplyRun(head, precheck, { link, assumeBusy: opts.self });
  return answer(result.outcome, [...precheck.warnings, ...result.warnings]);
}

/** FR-7: the chain head's skill map and whether it runs, for the dashboard dialog. */
export async function readConversationSkills(
  name: string,
  depsOverride?: Partial<SkillApplyDeps>,
): Promise<{ status: 200; body: ConversationSkillsBody } | SkillApplyResponse> {
  const deps = resolveDeps(depsOverride);
  const head = resolveHead(name, deps);
  if (!head) return errorResponse(404, 'Conversation not found');
  const verdict = await deps.isAlive(head.tmuxSession);
  return {
    status: 200,
    body: {
      conversation: head.name,
      harness: head.harness ?? 'claude-code',
      running: verdict.alive,
      skillOverrides: head.skillOverrides ?? {},
    },
  };
}
