/**
 * Plan critique I/O (PAN-4341): critique file paths, round counting from the
 * working tree and git history, label reads, and gathering the gate input.
 *
 * Nothing is stored: readiness is derived on every run from the critique
 * files, the current draft and git history (NFR-1). This module is reachable
 * from the dashboard server (complete-planning), so git reads use promisified
 * `execFile`, never `execSync`.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { planDigest } from '../xbrief/plan-digest.js';
import {
  evaluateCritiqueGate,
  isFlaggedByLabels,
  parseCritique,
  withUnresolvedSection,
  type CritiqueGateInput,
  type CritiqueGateResult,
} from './plan-critique.js';

export type ExecFileLike = (file: string, args: string[], options: { cwd: string }) => Promise<{ stdout: string }>;

const defaultExecFile: ExecFileLike = async (file, args, options) => {
  const { stdout } = await promisify(execFile)(file, args, { cwd: options.cwd, encoding: 'utf-8' });
  return { stdout };
};

async function defaultGetLabels(issueId: string): Promise<string[]> {
  const { defaultGetIssueLabels } = await import('../cloister/auto-merge-eligibility.js');
  return defaultGetIssueLabels(issueId);
}

/** The workspace PRD: `.pan/drafts/<ISSUE-UPPER>.md`, then `<issue-lower>.md`. */
export function resolveWorkspacePrdPath(workspacePath: string, issueId: string): string | null {
  const draftsDir = join(workspacePath, '.pan', 'drafts');
  for (const name of [`${issueId.toUpperCase()}.md`, `${issueId.toLowerCase()}.md`]) {
    const candidate = join(draftsDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** `<stem>-critique.md` for round 1, `<stem>-critique-2.md` for round 2, next to the PRD. */
export function critiquePathForRound(prdPath: string, round: 1 | 2): string {
  const stem = basename(prdPath).replace(/\.md$/i, '');
  return join(dirname(prdPath), round === 1 ? `${stem}-critique.md` : `${stem}-critique-2.md`);
}

async function everCommitted(workspacePath: string, path: string, execFileImpl: ExecFileLike): Promise<boolean> {
  try {
    const { stdout } = await execFileImpl('git', ['log', '--format=%H', '--', relative(workspacePath, path)], {
      cwd: workspacePath,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** A round is used when its file is in the tree or has ever been committed on the branch. */
export async function countCritiqueRounds(
  workspacePath: string,
  prdPath: string,
  deps: { execFileImpl?: ExecFileLike } = {},
): Promise<number> {
  const execFileImpl = deps.execFileImpl ?? defaultExecFile;
  let used = 0;
  for (const round of [1, 2] as const) {
    const path = critiquePathForRound(prdPath, round);
    if (existsSync(path) || (await everCommitted(workspacePath, path, execFileImpl))) used++;
  }
  return used;
}

/** Flagged when forced, or when the issue carries a critic label. Unreadable labels warn and count as unflagged. */
export async function isPlanFlagged(input: {
  issueId: string;
  forced: boolean;
  getLabels?: (id: string) => Promise<string[]>;
  warn: (msg: string) => void;
}): Promise<boolean> {
  if (input.forced) return true;
  try {
    const labels = await (input.getLabels ?? defaultGetLabels)(input.issueId);
    return isFlaggedByLabels(labels);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    input.warn(`Could not read labels for ${input.issueId}: ${detail}; plan critic not required`);
    return false;
  }
}

export async function loadCritiqueGateInput(input: {
  workspacePath: string;
  issueId: string;
  doc: unknown;
  required: boolean;
  execFileImpl?: ExecFileLike;
}): Promise<{ gateInput: CritiqueGateInput; prdPath: string | null }> {
  const currentDigest = planDigest(input.doc);
  const prdPath = resolveWorkspacePrdPath(input.workspacePath, input.issueId);
  if (!prdPath) {
    return { gateInput: { required: input.required, currentDigest, roundsUsed: 0, latest: null, prdText: null }, prdPath };
  }

  const roundsUsed = await countCritiqueRounds(input.workspacePath, prdPath, { execFileImpl: input.execFileImpl });
  let latest: CritiqueGateInput['latest'] = null;
  for (const round of [2, 1] as const) {
    const path = critiquePathForRound(prdPath, round);
    if (existsSync(path)) {
      latest = { round, critique: parseCritique(readFileSync(path, 'utf-8')) };
      break;
    }
  }

  return {
    gateInput: { required: input.required, currentDigest, roundsUsed, latest, prdText: readFileSync(prdPath, 'utf-8') },
    prdPath,
  };
}

/**
 * The complete-planning server's critique check (FR-13, FR-14). It verifies
 * and never dispatches a critic. At the two-round cap it writes the unanswered
 * `blocks-the-design` titles into the workspace PRD before promotion commits it.
 */
export async function applyCritiqueGateForPromotion(input: {
  issueId: string;
  workspacePath: string;
  doc: unknown;
  forced: boolean;
  getLabels?: (id: string) => Promise<string[]>;
  warn: (msg: string) => void;
  execFileImpl?: ExecFileLike;
}): Promise<{ ok: true; result: CritiqueGateResult } | { ok: false; result: CritiqueGateResult; message: string }> {
  const required = await isPlanFlagged({
    issueId: input.issueId,
    forced: input.forced,
    getLabels: input.getLabels,
    warn: input.warn,
  });
  const { gateInput, prdPath } = await loadCritiqueGateInput({
    workspacePath: input.workspacePath,
    issueId: input.issueId,
    doc: input.doc,
    required,
    execFileImpl: input.execFileImpl,
  });
  const result = evaluateCritiqueGate(gateInput);
  if (!result.ok) return { ok: false, result, message: result.reason };
  if (result.kind === 'cap-reached' && result.unresolved.length > 0 && prdPath && gateInput.prdText !== null) {
    const updated = withUnresolvedSection(gateInput.prdText, result.unresolved);
    if (updated !== gateInput.prdText) await writeFile(prdPath, updated, 'utf-8');
  }
  return { ok: true, result };
}
