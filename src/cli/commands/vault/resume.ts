/**
 * pan vault resume <id>[@<version>] [--cwd <dir>] [--no-launch] [--on-drift continue|note|cancel]
 *                  [--no-code] [--worktree <dir>]
 *
 * Continue a saved conversation on this machine (FR-5, FR-6, FR-12, P-16,
 * P-17). Adopts the record (or materializes an owned fork), then launches the
 * harness in the target cwd: `claude --resume <id>` or `codex resume <id>`.
 * Other harnesses get a seeded markdown digest instead (P-16).
 *
 * PAN-4329: when the record's latest WIP entry is a captured code snapshot,
 * resume applies it before adopting (D-14, D-15). A dirty checkout is never
 * written to; the snapshot goes into a fresh worktree instead (`--worktree`,
 * or yes at the TTY prompt). `--no-code` keeps the pre-PAN-4329 behavior. The
 * machine that owns the record skips this step: its checkout is where the
 * snapshot came from.
 */
import { spawn } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { adoptRecord, forkRecordAtVersion, materializeOwned, type AdoptResult } from '../../../lib/vault/adopt.js';
import { compareCwdState, readCwdState, type CwdStateField } from '../../../lib/vault/cwd-state.js';
import type { SessionRecord } from '../../../lib/vault/format.js';
import { readViewLines } from '../../../lib/vault/materialize.js';
import { buildSeedDigest, seedFileName } from '../../../lib/vault/seed.js';
import {
  applyWipSnapshot,
  applyWipSnapshotInWorktree,
  findLatestWip,
  isWipPresent,
  type CapturedWip,
  type WipApplyResult,
} from '../../../lib/vault/wip-apply.js';
import { defaultIo, formatBytes, openVault, type CliIo, type OpenVault } from './shared.js';
import { loadRecord, resolveVaultId } from './show.js';

export type DriftChoice = 'continue' | 'note' | 'cancel';

export interface ResumeOptions {
  cwd?: string;
  /** commander sets `launch: false` for --no-launch. */
  launch?: boolean;
  onDrift?: DriftChoice;
  /** commander sets `code: false` for --no-code. */
  code?: boolean;
  /** Apply the code snapshot into a new git worktree at this directory. */
  worktree?: string;
}

export interface ResumeDeps {
  spawn?: (command: string, args: string[], cwd: string) => Promise<number>;
  projectsRoot?: string;
  codexHome?: string;
}

export function parseResumeTarget(arg: string): { id: string; version: number | null } {
  const at = arg.lastIndexOf('@');
  if (at < 0) return { id: arg, version: null };
  const version = Number(arg.slice(at + 1));
  if (!Number.isInteger(version) || version < 1) throw new Error(`Version must be a positive integer: ${arg}`);
  return { id: arg.slice(0, at), version };
}

export function driftNote(fields: readonly CwdStateField[]): string {
  return `[Session Vault] This conversation was resumed in a working directory whose ${fields.join(', ')} differ${fields.length === 1 ? 's' : ''} from where it was saved. Check the current state before relying on earlier assumptions.`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

async function defaultSpawn(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd });
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function chooseOnDrift(io: CliIo, fields: CwdStateField[], flag: DriftChoice | undefined): Promise<DriftChoice> {
  if (flag) return flag;
  if (!io.isTTY) return 'cancel';
  io.out(`The working directory differs from where this conversation was saved: ${fields.join(', ')}.`);
  const answer = (await io.readLine('Continue (c), continue with a note (n), or cancel (x)? ')).trim().toLowerCase();
  if (answer === 'c' || answer === 'continue') return 'continue';
  if (answer === 'n' || answer === 'note') return 'note';
  return 'cancel';
}

async function resolveTargetCwd(record: SessionRecord, io: CliIo, flag: string | undefined): Promise<string | null> {
  if (flag) return resolve(flag);
  if (record.cwd) {
    try {
      if ((await stat(record.cwd)).isDirectory()) return record.cwd;
    } catch {
      // fall through
    }
  }
  io.err(`The saved working directory ${record.cwd || '(none)'} does not exist here. Pass --cwd <dir> to choose where to resume.`);
  return null;
}

type CodeStep = { kind: 'none' } | { kind: 'applied'; cwd: string } | { kind: 'exit' };

/**
 * D-14/D-15: apply the captured snapshot to `targetCwd`, or into a fresh
 * worktree when the checkout is dirty and the operator agrees (or passed
 * --worktree). Prints what happened; `exit` means the command must stop.
 */
async function applyCode(
  wip: CapturedWip,
  vaultId: string,
  targetCwd: string,
  vault: OpenVault,
  io: CliIo,
  worktreeFlag: string | undefined,
): Promise<CodeStep> {
  if ((await readCwdState(targetCwd)) === null) {
    io.out(`Code snapshot not applied: ${targetCwd} is not a git checkout.`);
    return { kind: 'none' };
  }
  // Nothing to carry when the checkout already holds this exact snapshot.
  if (worktreeFlag === undefined && await isWipPresent(targetCwd, wip)) return { kind: 'applied', cwd: targetCwd };
  const inWorktree = (worktreeDir: string) => applyWipSnapshotInWorktree({
    repoCwd: targetCwd, worktreeDir: resolve(worktreeDir), vaultId, wip, store: vault.store, keys: vault.keys,
  });
  let result: WipApplyResult = worktreeFlag !== undefined
    ? await inWorktree(worktreeFlag)
    : await applyWipSnapshot({ cwd: targetCwd, vaultId, wip, store: vault.store, keys: vault.keys });
  if (result.status === 'dirty') {
    const refusal = `Refusing to apply the code snapshot: ${targetCwd} has uncommitted changes. Commit or move them, or re-run with --worktree <dir>.`;
    if (!io.isTTY) {
      io.err(refusal);
      return { kind: 'exit' };
    }
    const fallback = `${targetCwd}-vault-${vaultId.slice(0, 8)}`;
    const answer = (await io.readLine(
      `The checkout at ${targetCwd} has uncommitted changes. Create a fresh worktree at ${fallback} instead? [y/N] `,
    )).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      io.err(refusal);
      return { kind: 'exit' };
    }
    result = await inWorktree(fallback);
  }
  if (result.status === 'failed') {
    io.err(`Cannot apply the code snapshot: ${result.reason}`);
    return { kind: 'exit' };
  }
  if (result.status === 'dirty') return { kind: 'exit' };
  io.out(`Applied code snapshot from ${wip.at} (${formatBytes(wip.bytes)}) at ${result.cwd}`);
  if (result.note) io.out(result.note);
  return { kind: 'applied', cwd: result.cwd };
}

export async function resumeCommand(target: string, options: ResumeOptions = {}, io: CliIo = defaultIo, deps: ResumeDeps = {}): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  let parsed: { id: string; version: number | null };
  try {
    parsed = parseResumeTarget(target);
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }
  const vaultId = await resolveVaultId(parsed.id);
  let record = vaultId ? await loadRecord(vaultId, vault.store, vault.keys) : null;
  if (!vaultId || !record) {
    io.err(`No saved conversation matches ${parsed.id}. Run pan vault sync, then pan vault list.`);
    return io.exit(1);
  }

  let targetCwd = await resolveTargetCwd(record, io, options.cwd);
  if (!targetCwd) return io.exit(1);

  // PAN-4329 code snapshot (D-11, D-14, D-15), skipped on the owning machine.
  const me = await ensureEnvironmentIdentity();
  const wip = options.code === false || record.owner.environmentId === me.environmentId ? null : findLatestWip(record);
  let codeApplied = false;
  if (wip && 'objects' in wip) {
    const step = await applyCode(wip, vaultId, targetCwd, vault, io, options.worktree);
    if (step.kind === 'exit') return io.exit(1);
    if (step.kind === 'applied') {
      targetCwd = step.cwd;
      codeApplied = true;
    }
  } else if (wip && wip.skipped !== 'clean' && wip.skipped !== 'no-git') {
    io.out(`No code snapshot: skipped (${wip.skipped}${wip.reason ? `, ${wip.reason}` : ''})`);
  }

  // FR-12 drift check against the last settlement, before anything is written.
  // An applied snapshot already reproduces the saved state.
  const saved = codeApplied ? null : record.settlements[record.settlements.length - 1]?.cwdState ?? null;
  const current = await readCwdState(targetCwd);
  let note: string | null = null;
  if (saved && current) {
    const fields = compareCwdState(saved, current);
    if (fields.length > 0) {
      const choice = await chooseOnDrift(io, fields, options.onDrift);
      if (choice === 'cancel') {
        io.err(`Cancelled: the working directory differs from the saved state in ${fields.join(', ')}. Re-run with --on-drift continue or --on-drift note.`);
        return io.exit(1);
      }
      if (choice === 'note') note = driftNote(fields);
    }
  }

  let activeId = vaultId;
  if (parsed.version !== null) {
    try {
      const fork = await forkRecordAtVersion({ vaultId, version: parsed.version, store: vault.store, keys: vault.keys });
      activeId = fork.vaultId;
      record = fork.record;
      io.out(`Forked ${vaultId.slice(0, 8)}@${parsed.version} as ${fork.vaultId.slice(0, 8)}.`);
    } catch (error) {
      io.err((error as Error).message);
      return io.exit(1);
    }
  }

  // Harnesses without a native resume path get the seeded digest (P-16).
  if (record.harness !== 'claude-code' && record.harness !== 'codex') {
    const view = await readViewLines(record, vault.store, vault.keys);
    const path = join(targetCwd, seedFileName(activeId));
    await writeFile(path, buildSeedDigest(record, view.lines));
    io.out(`${record.harness} has no native resume. Seed digest written to ${path}; open it in your harness to continue.`);
    return;
  }

  let outcome: AdoptResult;
  const mine = record.segments.find((segment) => segment.environmentId === me.environmentId);
  if (record.owner.environmentId === me.environmentId && mine) {
    outcome = { adopted: true, vaultId: activeId, path: '', newSessionId: mine.nativeSessionId, lines: mine.tail.lineCount };
  } else if (record.owner.environmentId === me.environmentId) {
    outcome = await materializeOwned({ vaultId: activeId, store: vault.store, keys: vault.keys, targetCwd, projectsRoot: deps.projectsRoot, codexHome: deps.codexHome });
  } else {
    outcome = await adoptRecord({ vaultId: activeId, store: vault.store, keys: vault.keys, targetCwd, projectsRoot: deps.projectsRoot, codexHome: deps.codexHome });
  }
  if (!outcome.adopted) {
    io.err(codeApplied
      ? `Code snapshot applied in ${targetCwd}, but the conversation was already continued on ${outcome.alreadyContinuedOn}; it was not adopted.`
      : `Already continued on ${outcome.alreadyContinuedOn}. Run pan vault sync and resume again to take it over from there.`);
    return io.exit(1);
  }

  const command = record.harness === 'codex' ? 'codex' : 'claude';
  const args = record.harness === 'codex'
    ? ['resume', outcome.newSessionId]
    : ['--resume', outcome.newSessionId, ...(note ? [note] : [])];
  if (record.harness === 'codex' && note) io.out(note);
  if (outcome.path) io.out(`Materialized ${outcome.lines} line${outcome.lines === 1 ? '' : 's'} to ${outcome.path}`);
  const commandLine = [command, ...args].map(shellQuote).join(' ');
  if (options.launch === false) {
    io.out(`cd ${shellQuote(targetCwd)} && ${commandLine}`);
    return;
  }
  const code = await (deps.spawn ?? defaultSpawn)(command, args, targetCwd);
  if (code !== 0) return io.exit(code);
}

export type { OpenVault };
