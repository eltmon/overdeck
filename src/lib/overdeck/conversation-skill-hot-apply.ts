/**
 * PAN-5465 WI-3: hot apply of a conversation's pack skills into a running
 * Claude Code session — rebuild the mount, re-point the plugin link, and
 * deliver `/reload-plugins`, without restarting the harness (NFR-2).
 *
 * - D-3: a conversation is hot-capable only when the process table shows it
 *   running with `--plugin-dir <its link>`.
 * - D-4: a mid-turn conversation gets `queued`; Claude Code runs a slash
 *   command sent mid-turn when the turn ends.
 * - D-5: an idle apply reloads twice (baseline, then after the re-point) and
 *   compares skill counts, because a `Reloaded:` line prints either way.
 * - D-7: one pack resolution feeds both the D-8 check and the mount.
 * - D-8: packs that need launch-time settings are never hot-applied.
 * - D-9: delivery uses `deliverAgentMessage(…, 'tmux')` after the message
 *   path's permission-prompt and main-input-target checks.
 *
 * `hotApplyPrecheck` writes nothing; the caller stores the map after `ready`
 * and then calls `hotApplyRun`. All I/O is injectable (`HotApplyDeps`).
 */
import type { LaunchPackMcp, LaunchSkillContext } from '../skill-overrides/launch.js';
import type { Mount, MountSelection } from '../skill-packs/mount.js';
import type { LegacyConversation } from './conversations.js';

export type HotApplyReady = {
  kind: 'ready';
  /** The one resolution (D-7) used for both the D-8 check and the mount. */
  selection: MountSelection;
  /** Pack id → skill dir names under the link target now. */
  mounted: Map<string, Set<string>>;
  /** The selection's warnings. */
  warnings: string[];
};

export type HotApplyResult =
  | { kind: 'applied'; outcome: 'hot' | 'sent' | 'queued'; warnings: string[] }
  | { kind: 'not-hot'; reason: 'no-plugin-dir' | 'launch-wired'; packs?: string[] }
  | { kind: 'refused'; status: 409; body: { error: string; code: string } };

export interface HotApplyDeps {
  readProcessArgs: () => Promise<string[]>;
  readPane: (session: string) => Promise<string>;
  deliver: (session: string, text: string) => Promise<{ ok: boolean; failure?: string }>;
  pendingPermission: (conv: LegacyConversation) => Promise<{ answerable: boolean } | null>;
  ensureMainInput: (session: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  resolveSelection: (ctx: LaunchSkillContext) => Promise<{ selection: MountSelection; mcp: LaunchPackMcp[]; warnings: string[] }>;
  readMountedSkills: (link: string) => Promise<Map<string, Set<string>>>;
  buildMount: (selection: MountSelection) => Promise<Mount | null>;
  relink: (link: string, mount: Mount | null) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

export const RELOAD_COMMAND = '/reload-plugins';
/** D-5: poll the pane every second for up to 15 s per reload. */
export const RELOAD_POLL_MS = 1000;
export const RELOAD_POLL_ATTEMPTS = 15;
export const QUEUED_WARNING = 'The reload is queued and runs when the current turn ends. If the conversation is idle, send /reload-plugins.';
export const SECOND_RELOAD_UNCONFIRMED_WARNING = 'The second reload was not confirmed.';

/** D-8: packs whose effect needs launch-time settings, by id. */
const LAUNCH_WIRED_PACK_IDS = new Set(['deft', 'sageox']);

const defaultDeps: HotApplyDeps = {
  readProcessArgs: async () => {
    const { readProcessTable } = await import('./conversation-runtime.js');
    return (await readProcessTable()).map((row) => row.args);
  },
  readPane: async (session) => {
    const { readAgentPaneText } = await import('../terminal-backends/agent-pane-io.js');
    return readAgentPaneText(session, 200, undefined, 'visible');
  },
  deliver: async (session, text) => {
    const { deliverAgentMessage } = await import('../agents/delivery.js');
    return deliverAgentMessage(session, text, 'skill-reload', 'tmux');
  },
  pendingPermission: async (conv) => {
    const { conversationPendingPermission } = await import('./conversation-permission.js');
    return conversationPendingPermission(conv);
  },
  ensureMainInput: async (session) => {
    const { ensureMainInputTarget } = await import('../agents/input-target.js');
    const target = await ensureMainInputTarget(session);
    return target.ok ? { ok: true } : { ok: false, reason: target.reason };
  },
  resolveSelection: async (ctx) => {
    const { launchPackExclude, resolveLaunchPackSelection } = await import('../skill-overrides/launch.js');
    const { exclude } = await launchPackExclude(ctx, 'claude-code');
    return resolveLaunchPackSelection(ctx, exclude);
  },
  readMountedSkills: async (link) => {
    const { readdir, realpath } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const mounted = new Map<string, Set<string>>();
    let target: string;
    try {
      target = await realpath(link);
    } catch {
      return mounted; // A missing or dangling link mounts nothing.
    }
    const dirNames = async (dir: string): Promise<string[]> => {
      try {
        return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    };
    for (const pack of await dirNames(target)) {
      mounted.set(pack, new Set(await dirNames(join(target, pack, 'skills'))));
    }
    return mounted;
  },
  buildMount: async (selection) => {
    const { buildMount } = await import('../skill-packs/mount.js');
    return buildMount(selection);
  },
  relink: async (link, mount) => {
    const { linkClaudeMount } = await import('../skill-packs/mount.js');
    await linkClaudeMount(link, mount);
  },
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

function withDefaults(deps: Partial<HotApplyDeps> = {}): HotApplyDeps {
  return { ...defaultDeps, ...deps };
}

/** D-3: some process runs with `--plugin-dir <link>`, followed by a space or the end of its args. */
export function hasPluginDirArg(args: readonly string[], link: string): boolean {
  const needle = `--plugin-dir ${link}`;
  return args.some((line) => {
    for (let at = line.indexOf(needle); at !== -1; at = line.indexOf(needle, at + 1)) {
      const next = line.charAt(at + needle.length);
      if (next === '' || next === ' ') return true;
    }
    return false;
  });
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** D-8: ids of launch-wired packs whose skill set differs between the new selection and the live mount. */
export function launchWiredChange(
  selection: MountSelection,
  mcp: readonly LaunchPackMcp[],
  mounted: Map<string, Set<string>>,
): string[] {
  const mcpIds = new Set(mcp.map((entry) => entry.packId));
  const wired = new Set<string>();
  const selected = new Map(selection.packs.map((pack) => [pack.id, pack]));
  for (const id of new Set([...selected.keys(), ...mounted.keys()])) {
    const pack = selected.get(id);
    const isWired = LAUNCH_WIRED_PACK_IDS.has(id) || pack?.transform === 'gstack-runtime' || mcpIds.has(id);
    if (!isWired) continue;
    const next = new Set((pack?.skills ?? []).map((skill) => skill.name));
    if (!sameSet(next, mounted.get(id) ?? new Set())) wired.add(id);
  }
  return [...wired].sort();
}

const RELOADED_LINE = /Reloaded: (\d+) plugins? · (\d+) skills?/g;

/** D-5: the `Reloaded:` lines on the pane — how many, the last one's text, and its skill count. */
export function readReloadLines(pane: string): { count: number; last: string | null; skills: number | null } {
  const matches = [...pane.matchAll(RELOADED_LINE)];
  const last = matches.length > 0 ? matches[matches.length - 1] : undefined;
  return { count: matches.length, last: last?.[0] ?? null, skills: last ? Number(last[2]) : null };
}

type ReloadSnapshot = ReturnType<typeof readReloadLines>;

function isNewLine(now: ReloadSnapshot, before: ReloadSnapshot): boolean {
  return now.count > before.count || (now.last !== null && now.last !== before.last);
}

async function readSnapshot(deps: HotApplyDeps, session: string): Promise<ReloadSnapshot | null> {
  try {
    return readReloadLines(await deps.readPane(session));
  } catch {
    return null; // A pane read that throws counts as "no new line yet".
  }
}

/** Polls every second, up to 15 times, for a `Reloaded:` line newer than `before`. */
async function waitForNewReload(deps: HotApplyDeps, session: string, before: ReloadSnapshot): Promise<ReloadSnapshot | null> {
  for (let attempt = 0; attempt < RELOAD_POLL_ATTEMPTS; attempt++) {
    await deps.sleep(RELOAD_POLL_MS);
    const now = await readSnapshot(deps, session);
    if (now && isNewLine(now, before)) return now;
  }
  return null;
}

function notDeliveredWarning(failure: string | undefined): string {
  return `The reload was not delivered: ${failure ?? 'unknown failure'}. Send /reload-plugins to the conversation.`;
}

const EMPTY_SNAPSHOT: ReloadSnapshot = { count: 0, last: null, skills: null };

/** Checks only; writes nothing (the caller writes the row after a `ready`, D-13). */
export async function hotApplyPrecheck(
  conv: LegacyConversation,
  opts: { link: string; conversationLayer: Record<string, boolean> },
  depsOverride?: Partial<HotApplyDeps>,
): Promise<HotApplyReady | Exclude<HotApplyResult, { kind: 'applied' }>> {
  const deps = withDefaults(depsOverride);
  let args: string[];
  try {
    args = await deps.readProcessArgs();
  } catch {
    return { kind: 'not-hot', reason: 'no-plugin-dir' };
  }
  if (!hasPluginDirArg(args, opts.link)) return { kind: 'not-hot', reason: 'no-plugin-dir' };

  const ctx: LaunchSkillContext = {
    cwd: conv.cwd,
    issueId: conv.issueId ?? undefined,
    conversation: conv.tmuxSession,
    conversationLayer: opts.conversationLayer,
  };
  const { selection, mcp, warnings } = await deps.resolveSelection(ctx);
  const mounted = await deps.readMountedSkills(opts.link);
  const wired = launchWiredChange(selection, mcp, mounted);
  if (wired.length > 0) return { kind: 'not-hot', reason: 'launch-wired', packs: wired };

  if ((await deps.pendingPermission(conv))?.answerable) {
    return {
      kind: 'refused',
      status: 409,
      body: { error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending' },
    };
  }
  const target = await deps.ensureMainInput(conv.tmuxSession);
  if (!target.ok) return { kind: 'refused', status: 409, body: { error: target.reason, code: 'input-target-not-main' } };

  return { kind: 'ready', selection, mounted, warnings };
}

/** Applies a `ready` precheck result. Assumes the row is already written. */
export async function hotApplyRun(
  conv: LegacyConversation,
  ready: HotApplyReady,
  opts: { link: string; assumeBusy: boolean },
  depsOverride?: Partial<HotApplyDeps>,
): Promise<Extract<HotApplyResult, { kind: 'applied' }>> {
  const deps = withDefaults(depsOverride);
  const session = conv.tmuxSession;
  const mount = await deps.buildMount(ready.selection);

  // D-4: the caller is mid-turn by definition; Claude Code queues the reload until the turn ends.
  if (opts.assumeBusy) {
    await deps.relink(opts.link, mount);
    const delivery = await deps.deliver(session, RELOAD_COMMAND);
    if (!delivery.ok) return { kind: 'applied', outcome: 'sent', warnings: [notDeliveredWarning(delivery.failure)] };
    return { kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] };
  }

  // D-5 step 1: baseline reload with the link unchanged.
  const beforeBaseline = (await readSnapshot(deps, session)) ?? EMPTY_SNAPSHOT;
  const first = await deps.deliver(session, RELOAD_COMMAND);
  if (!first.ok) {
    await deps.relink(opts.link, mount);
    return { kind: 'applied', outcome: 'sent', warnings: [notDeliveredWarning(first.failure)] };
  }
  const baseline = await waitForNewReload(deps, session, beforeBaseline);

  if (baseline === null) {
    // D-4 busy fallback: the baseline reload is still queued, so re-point first and let it run against the new mount.
    await deps.relink(opts.link, mount);
    const afterRelink = await readSnapshot(deps, session);
    if (afterRelink && isNewLine(afterRelink, beforeBaseline)) {
      // The turn ended between the timeout and the re-point, so the queued reload ran against the old mount.
      const again = await deps.deliver(session, RELOAD_COMMAND);
      if (!again.ok) return { kind: 'applied', outcome: 'sent', warnings: [notDeliveredWarning(again.failure)] };
    }
    return { kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] };
  }

  // D-5 steps 2–3: re-point, then reload again.
  await deps.relink(opts.link, mount);
  const second = await deps.deliver(session, RELOAD_COMMAND);
  if (!second.ok) return { kind: 'applied', outcome: 'sent', warnings: [notDeliveredWarning(second.failure)] };
  const after = await waitForNewReload(deps, session, baseline);
  if (after === null) return { kind: 'applied', outcome: 'sent', warnings: [SECOND_RELOAD_UNCONFIRMED_WARNING] };

  // D-5 step 4: the skill count must rise by exactly the mounted-skill delta.
  const oldCount = [...ready.mounted.values()].reduce((sum, skills) => sum + skills.size, 0);
  const newCount = ready.selection.packs.reduce((sum, pack) => sum + pack.skills.length, 0);
  const expected = newCount - oldCount;
  const actual = (after.skills ?? 0) - (baseline.skills ?? 0);
  if (actual === expected) return { kind: 'applied', outcome: 'hot', warnings: [] };
  return {
    kind: 'applied',
    outcome: 'sent',
    warnings: [`Reloaded, but the skill count changed by ${actual}, expected ${expected}. Check the conversation.`],
  };
}
