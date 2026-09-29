/**
 * pan vault allow-secret <vaultId|path> <line>
 * pan vault allow-secret <vaultId> --file <path>
 *
 * Allow one blocked line (FR-13, P-8): its hash is stored per record in
 * vault/allowed-secrets.json so it never blocks again. The transcript is
 * named by vaultId (owned record) or by path (a transcript that has not been
 * saved yet, whose vaultId is not durable).
 *
 * `--file` (PAN-4329 D-5) allows the blocked added lines of one file in the
 * record's code snapshot: it rebuilds the WIP commit in the record's cwd,
 * rescans, and allows the hash of every blocked line of that file.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { lineHash, splitSettleableLines } from '../../../lib/vault/continuity.js';
import { listOwned } from '../../../lib/vault/local-index.js';
import { allowSecret, scanWipPatch } from '../../../lib/vault/secrets.js';
import { buildWipCommit, wipPatch } from '../../../lib/vault/wip-capture.js';
import { defaultIo, openVault, type CliIo, type OpenVault } from './shared.js';
import { loadRecord } from './show.js';

export interface AllowSecretOptions {
  file?: string;
}

async function allowSecretFile(target: string, file: string, vault: OpenVault, io: CliIo): Promise<void> {
  const owned = Object.values(await listOwned()).find((entry) => entry.vaultId === target || entry.vaultId.startsWith(target));
  const record = owned ? await loadRecord(owned.vaultId, vault.store, vault.keys) : null;
  if (!owned || !record) {
    io.err(`No owned record matches ${target}.`);
    return io.exit(1);
  }
  const vaultId = owned.vaultId;
  const commit = record.cwd ? await buildWipCommit(record.cwd, vaultId) : null;
  if (!commit) {
    io.err(`${record.cwd || 'The record'} is not a git checkout; there is no code snapshot to allow.`);
    return io.exit(1);
  }
  let allowed = 0;
  let wanted = file;
  try {
    wanted = isAbsolute(file) ? relative(commit.root, file) : file.replace(/^\.\//, '');
    const hits = await scanWipPatch(vaultId, await wipPatch(commit.root, commit.wip));
    for (const hit of hits.filter((entry) => entry.file === wanted)) {
      await allowSecret(vaultId, hit.hash);
      allowed++;
    }
  } finally {
    await commit.cleanup();
  }
  if (allowed === 0) {
    io.err(`No blocked lines in ${wanted}.`);
    return io.exit(1);
  }
  io.out(`Allowed ${allowed} line(s) of ${wanted} for record ${vaultId.slice(0, 8)}. Run pan vault save to retry the code snapshot.`);
}

export async function allowSecretCommand(
  target: string,
  lineArg: string | undefined,
  options: AllowSecretOptions = {},
  io: CliIo = defaultIo,
): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  if ((lineArg === undefined) === (options.file === undefined)) {
    io.err('Give a line number or --file <path>.');
    return io.exit(1);
  }
  if (options.file !== undefined) return allowSecretFile(target, options.file, vault, io);
  const lineNumber = Number(lineArg);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    io.err(`Line must be a positive integer: ${lineArg}`);
    return io.exit(1);
  }
  const owned = await listOwned();
  let nativePath: string | null = null;
  let vaultId: string | null = null;
  for (const [path, entry] of Object.entries(owned)) {
    if (entry.vaultId === target || entry.vaultId.startsWith(target)) {
      nativePath = path;
      vaultId = entry.vaultId;
      break;
    }
  }
  if (!nativePath) nativePath = resolve(target);
  let bytes: Buffer;
  try {
    bytes = await readFile(nativePath);
  } catch {
    io.err(`No owned record matches ${target} and no transcript exists at ${nativePath}.`);
    return io.exit(1);
  }
  const { lines } = splitSettleableLines(bytes);
  const line = lines[lineNumber - 1];
  if (line === undefined) {
    io.err(`${nativePath} has ${lines.length} settleable line${lines.length === 1 ? '' : 's'}; line ${lineNumber} does not exist.`);
    return io.exit(1);
  }
  const hash = lineHash(line);
  await allowSecret(nativePath, hash);
  if (vaultId) await allowSecret(vaultId, hash);
  io.out(`Allowed line ${lineNumber} of ${nativePath} (hash ${hash}) for ${vaultId ? `record ${vaultId.slice(0, 8)}` : 'its next save'}. The line will be saved as-is; the vault key protects it.`);
}
