/**
 * pan vault allow-secret <vaultId|path> <line>
 *
 * Allow one blocked line (FR-13, P-8): its hash is stored per record in
 * vault/allowed-secrets.json so it never blocks again. The transcript is
 * named by vaultId (owned record) or by path (a transcript that has not been
 * saved yet, whose vaultId is not durable).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lineHash, splitSettleableLines } from '../../../lib/vault/continuity.js';
import { listOwned } from '../../../lib/vault/local-index.js';
import { allowSecret } from '../../../lib/vault/secrets.js';
import { defaultIo, openVault, type CliIo } from './shared.js';

export async function allowSecretCommand(target: string, lineArg: string, _options: Record<string, never> = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
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
