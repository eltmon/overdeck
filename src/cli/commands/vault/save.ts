/**
 * pan vault save [session-id|path] [--all] [--since <date>] [--harness <h>] [--hook]
 *
 * Settle one or many native transcripts into the vault (FR-3). `--hook` is
 * the Claude Code Stop-hook mode (P-15): it reads `{ session_id,
 * transcript_path }` JSON from stdin, never writes to stdout and always exits
 * 0, so it can never block Claude Code.
 *
 * Both modes capture a WIP code snapshot in `'force'` mode (PAN-4329 D-1); the
 * command reports its outcome after the transcript verdict.
 */
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { discoverTranscripts, isFile, type DiscoveredTranscript } from '../../../lib/vault/discover.js';
import { settle, type SettleResult } from '../../../lib/vault/settle.js';
import type { WipCaptureResult } from '../../../lib/vault/wip-capture.js';
import { defaultIo, formatBytes, openVault, type CliIo, type OpenVault } from './shared.js';

export interface SaveOptions {
  all?: boolean;
  since?: string;
  harness?: string;
  hook?: boolean;
}

export interface SaveTarget {
  nativePath: string;
  harness: string;
}

/** The WIP outcome suffix for a save line (FR-7); empty when there is nothing to say. */
export function describeWip(wip: WipCaptureResult | undefined, vaultId: string, wipMaxBytes?: number): string {
  if (!wip) return '';
  switch (wip.status) {
    case 'captured':
      return `; code snapshot saved (${formatBytes(wip.wip.bytes)})`;
    case 'unchanged':
      return '; code unchanged';
    case 'no-git':
    case 'off':
    case 'throttled':
      return '';
    case 'skipped':
      switch (wip.wip.skipped) {
        case 'secret': {
          const hits = wip.hits ?? [];
          const files = [...new Set(hits.map((hit) => hit.file))];
          const blocked = hits.map((hit) => `${hit.file} (${hit.pattern})`).join(', ');
          const allow = files.map((file) => `pan vault allow-secret ${vaultId.slice(0, 8)} --file ${file}`).join('; ');
          return `; code snapshot blocked: ${blocked || wip.wip.reason || 'secret'}${allow ? ` — allow with: ${allow}` : ''}`;
        }
        case 'too-large': {
          const cap = wipMaxBytes === undefined ? 'size' : formatBytes(wipMaxBytes);
          return `; code snapshot skipped: ${formatBytes(wip.wip.bytes ?? 0)} exceeds the ${cap} cap`;
        }
        case 'clean':
          return '; code clean (nothing uncommitted or unpushed)';
        case 'error':
          return `; code snapshot failed: ${wip.wip.reason ?? 'unknown error'}`;
        case 'no-git':
          return '';
      }
  }
}

/** True when the code snapshot was refused in a way the operator must act on (exit 1). */
function wipFailed(result: SettleResult): boolean {
  if (result.verdict !== 'append' && result.verdict !== 'noop') return false;
  const wip = result.wip;
  return wip?.status === 'skipped' && (wip.wip.skipped === 'secret' || wip.wip.skipped === 'error');
}

export function describeVerdict(result: SettleResult, wipMaxBytes?: number): string {
  switch (result.verdict) {
    case 'append':
      return `appended ${result.lines} line${result.lines === 1 ? '' : 's'} (vault ${result.vaultId.slice(0, 8)}, version ${result.version})`
        + (result.forkedFrom ? `; forked from ${result.forkedFrom.vaultId.slice(0, 8)}@${result.forkedFrom.version}` : '')
        + describeWip(result.wip, result.vaultId, wipMaxBytes);
    case 'noop':
      return `noop${describeWip(result.wip, result.vaultId, wipMaxBytes)}`;
    case 'blocked':
      return result.hits.map((hit) => `blocked at line ${hit.line}: ${hit.pattern}`).join('; ');
    case 'diverged':
      return `diverged: ${result.reason}`;
    case 'excluded':
      return 'excluded';
    case 'offline':
      return 'offline';
  }
}

/** Codex rollouts live under `.codex/`, a managed agent's `codex-home/`, or are named `rollout-*.jsonl`. */
export function harnessForPath(path: string): string {
  return /[\\/]\.codex[\\/]|[\\/]codex-home[\\/]|[\\/]rollout-[^\\/]*\.jsonl$/.test(path) ? 'codex' : 'claude-code';
}

/** Turn the positional argument and flags into the transcripts to settle. */
export async function resolveTargets(
  target: string | undefined,
  options: SaveOptions,
  discover: () => Promise<DiscoveredTranscript[]> = discoverTranscripts,
): Promise<SaveTarget[]> {
  if (target) {
    const asPath = resolve(target);
    if (await isFile(asPath)) return [{ nativePath: asPath, harness: harnessForPath(asPath) }];
    const files = await discover();
    const matches = files.filter((file) => file.sessionId === target || file.sessionId.startsWith(target));
    return matches.map((file) => ({ nativePath: file.nativePath, harness: file.harness }));
  }
  if (!options.all) throw new Error('Give a session id, a transcript path, or --all.');
  const since = options.since ? new Date(options.since) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error(`--since ${options.since} is not a date`);
  const files = await discover();
  const out: SaveTarget[] = [];
  for (const file of files) {
    if (options.harness && file.harness !== options.harness) continue;
    if (since) {
      try {
        if ((await stat(file.nativePath)).mtimeMs < since.getTime()) continue;
      } catch {
        continue;
      }
    }
    out.push({ nativePath: file.nativePath, harness: file.harness });
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Stop-hook mode: settle the transcript named on stdin; silent; exit 0 no matter what. */
export async function saveHook(input: string, vault: OpenVault | null): Promise<SettleResult | null> {
  if (!vault) return null;
  let payload: { session_id?: unknown; transcript_path?: unknown };
  try {
    payload = JSON.parse(input) as typeof payload;
  } catch {
    return null;
  }
  if (typeof payload.transcript_path !== 'string') return null;
  try {
    return await settle({
      nativePath: payload.transcript_path,
      harness: harnessForPath(payload.transcript_path),
      store: vault.store,
      keys: vault.keys,
      config: vault.config,
      wip: 'force',
      ...(typeof payload.session_id === 'string' ? { nativeSessionId: payload.session_id } : {}),
    });
  } catch {
    return null;
  }
}

export async function saveCommand(
  target: string | undefined,
  options: SaveOptions = {},
  io: CliIo = defaultIo,
  deps: { discover?: () => Promise<DiscoveredTranscript[]>; stdin?: () => Promise<string> } = {},
): Promise<void> {
  if (options.hook) {
    try {
      const vault = await openVault(io, { quiet: true });
      await saveHook(await (deps.stdin ?? readStdin)(), vault);
    } catch {
      // never block the harness
    }
    return;
  }
  const vault = await openVault(io);
  if (!vault) return;
  let targets: SaveTarget[];
  try {
    targets = await resolveTargets(target, options, deps.discover);
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }
  if (targets.length === 0) {
    io.out(target ? `No transcript matches ${target}.` : 'No transcripts found.');
    return;
  }
  let failed = 0;
  for (const entry of targets) {
    let result: SettleResult;
    try {
      result = await settle({
        nativePath: entry.nativePath,
        harness: entry.harness,
        store: vault.store,
        keys: vault.keys,
        config: vault.config,
        wip: 'force',
      });
    } catch (error) {
      // One broken transcript must not stop the rest of --all.
      io.out(`${basename(entry.nativePath)}: error: ${(error as Error).message}`);
      failed++;
      continue;
    }
    io.out(`${basename(entry.nativePath)}: ${describeVerdict(result, vault.config.wipMaxBytes)}`);
    if (result.verdict === 'blocked' || result.verdict === 'diverged' || result.verdict === 'offline' || wipFailed(result)) failed++;
    if (result.verdict === 'offline') break;
  }
  if (failed > 0) return io.exit(1);
}
