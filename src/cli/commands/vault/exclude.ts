/**
 * pan vault exclude [path] [--origin <url>] [--session <id>]
 * pan vault include [path] [--origin <url>] [--session <id>]
 *
 * Exclusions (P-11). Excluding a session that already has a record replaces
 * its ref value with a tombstone through casRef; `pan vault list` hides
 * tombstoned rows. Chunk objects stay in the backend's history as ciphertext.
 */
import { basename, extname, resolve } from 'node:path';
import { encryptRef, refName, type SessionTombstone } from '../../../lib/vault/format.js';
import { addExclusion, removeExclusion } from '../../../lib/vault/exclude.js';
import { listOwned, readListCache, removeOwned, replaceListCache } from '../../../lib/vault/local-index.js';
import { defaultIo, openVault, type CliIo, type OpenVault } from './shared.js';
import { resolveVaultId } from './show.js';

export interface ExcludeOptions {
  origin?: string;
  session?: string;
}

/**
 * A `--session` value may be a vaultId (or prefix) or a native session id. A
 * native id is the transcript's file name, so it resolves through the local
 * index of owned transcripts to the record that saved it.
 */
export async function resolveSessionVaultId(session: string): Promise<string | null> {
  const owned = await listOwned();
  for (const [nativePath, entry] of Object.entries(owned)) {
    if (basename(nativePath, extname(nativePath)) === session) return entry.vaultId;
  }
  const rows = await readListCache();
  const byVault = await resolveVaultId(session).catch(() => null);
  if (byVault && (rows.some((row) => row.vaultId === byVault) || Object.values(owned).some((entry) => entry.vaultId === byVault))) return byVault;
  return null;
}

function nothingGiven(path: string | undefined, options: ExcludeOptions): boolean {
  return !path && !options.origin && !options.session;
}

/** Write the P-11 tombstone for `vaultId` and forget it locally. */
export async function tombstoneRecord(vaultId: string, vault: OpenVault): Promise<'ok' | 'conflict' | 'missing'> {
  const name = refName('record', vaultId, vault.keys.K_ref);
  const current = await vault.store.readRef(name);
  if (!current) return 'missing';
  const tombstone: SessionTombstone = { v: 1, type: 'session', vaultId, tombstone: true };
  const outcome = await vault.store.casRef(name, current.version, await encryptRef(name, tombstone, vault.keys));
  if (outcome !== 'ok') return outcome;
  for (const [nativePath, entry] of Object.entries(await listOwned())) {
    if (entry.vaultId === vaultId) await removeOwned(nativePath);
  }
  const rows = await readListCache();
  await replaceListCache(rows.map((row) => (row.vaultId === vaultId ? { ...row, tombstone: true } : row)));
  return 'ok';
}

export async function excludeCommand(path: string | undefined, options: ExcludeOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  if (nothingGiven(path, options)) {
    io.err('Give a path, --origin <url>, or --session <id>.');
    return io.exit(1);
  }
  if (path) {
    await addExclusion('paths', path);
    io.out(`Excluded conversations under ${resolve(path)}.`);
  }
  if (options.origin) {
    await addExclusion('origins', options.origin);
    io.out(`Excluded conversations whose git origin is ${options.origin}.`);
  }
  if (options.session) {
    const vaultId = await resolveSessionVaultId(options.session);
    if (vaultId) {
      await addExclusion('sessions', vaultId);
      // A native session id (the transcript file name) is recorded too, so the
      // file stays excluded even if it is saved again under a new record.
      if (vaultId !== options.session && /^[0-9a-f-]{36}$/i.test(options.session)) await addExclusion('sessions', options.session);
      const outcome = await tombstoneRecord(vaultId, vault);
      io.out(outcome === 'ok'
        ? `Excluded ${vaultId.slice(0, 8)} and replaced its saved record with a tombstone.`
        : `Excluded ${vaultId.slice(0, 8)} (record ${outcome === 'missing' ? 'not on the backend' : 'changed concurrently; run pan vault sync and retry'}).`);
    } else {
      await addExclusion('sessions', options.session);
      io.out(`Excluded session ${options.session}.`);
    }
  }
}

export async function includeCommand(path: string | undefined, options: ExcludeOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  if (nothingGiven(path, options)) {
    io.err('Give a path, --origin <url>, or --session <id>.');
    return io.exit(1);
  }
  if (path) {
    await removeExclusion('paths', path);
    io.out(`Included conversations under ${resolve(path)} again.`);
  }
  if (options.origin) {
    await removeExclusion('origins', options.origin);
    io.out(`Included conversations whose git origin is ${options.origin} again.`);
  }
  if (options.session) {
    const vaultId = await resolveSessionVaultId(options.session);
    await removeExclusion('sessions', vaultId ?? options.session);
    if (vaultId && vaultId !== options.session) await removeExclusion('sessions', options.session);
    io.out(`Included session ${options.session} again. A tombstoned record stays a tombstone; new lines start a new record.`);
  }
}
