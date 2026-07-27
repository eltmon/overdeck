import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { acquireRecordLock, releaseRecordLock } from '../pan-dir/fs-lock.js';

interface AutoSpawnConsentRecord {
  version: 2;
  generation: string;
  status: 'granted' | 'claimed' | 'spent';
  claimId?: string;
  updatedAt: string;
}

export interface AutoSpawnConsentClaim {
  issueId: string;
  generation: string;
  claimId: string;
}

export type AcceptAutoSpawnConsent = () => Promise<void>;

function getOverdeckHome(): string {
  return process.env['OVERDECK_HOME'] ?? join(homedir(), '.overdeck');
}

export function autoSpawnOnFinalizeFlagPath(issueId: string): string {
  return join(getOverdeckHome(), 'agents', `planning-${issueId.toLowerCase()}`, 'auto-spawn-on-finalize.json');
}

function autoSpawnConsentLockPath(issueId: string): string {
  return join(getOverdeckHome(), 'locks', 'auto-spawn-consent', `${issueId.toLowerCase()}.lock`);
}

function parseConsentRecord(raw: string): AutoSpawnConsentRecord | null {
  const value = JSON.parse(raw) as Partial<AutoSpawnConsentRecord> & { autoSpawnOnFinalize?: unknown };
  if (value.version === 2 && typeof value.generation === 'string'
    && (value.status === 'granted' || value.status === 'claimed' || value.status === 'spent')) {
    return value as AutoSpawnConsentRecord;
  }
  if (typeof value.autoSpawnOnFinalize === 'boolean') {
    return {
      version: 2,
      generation: 'legacy',
      status: value.autoSpawnOnFinalize ? 'granted' : 'spent',
      updatedAt: new Date(0).toISOString(),
    };
  }
  return null;
}

function readConsentRecordSync(issueId: string): AutoSpawnConsentRecord | null {
  try {
    const path = autoSpawnOnFinalizeFlagPath(issueId);
    if (!existsSync(path)) return null;
    return parseConsentRecord(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readConsentRecord(issueId: string): Promise<AutoSpawnConsentRecord | null> {
  try {
    return parseConsentRecord(await readFile(autoSpawnOnFinalizeFlagPath(issueId), 'utf8'));
  } catch {
    return null;
  }
}

async function readConsentRecordForTransition(issueId: string): Promise<AutoSpawnConsentRecord | null> {
  try {
    const record = parseConsentRecord(await readFile(autoSpawnOnFinalizeFlagPath(issueId), 'utf8'));
    if (!record) throw new Error(`Invalid auto-start consent state for ${issueId.toUpperCase()}`);
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeConsentRecord(issueId: string, record: AutoSpawnConsentRecord): Promise<void> {
  const path = autoSpawnOnFinalizeFlagPath(issueId);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, JSON.stringify(record), { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withConsentLock<T>(issueId: string, writerId: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = autoSpawnConsentLockPath(issueId);
  await acquireRecordLock(lockPath, {
    writerId,
    recordPath: autoSpawnOnFinalizeFlagPath(issueId),
  });
  try {
    return await operation();
  } finally {
    await releaseRecordLock(lockPath);
  }
}

export function readAutoSpawnOnFinalizeFlag(issueId: string): boolean {
  return readConsentRecordSync(issueId)?.status === 'granted';
}

export async function readAutoSpawnOnFinalizeFlagAsync(issueId: string): Promise<boolean> {
  return (await readConsentRecord(issueId))?.status === 'granted';
}

export async function writeAutoSpawnOnFinalizeFlag(issueId: string, enabled: boolean): Promise<void> {
  await withConsentLock(issueId, 'planning-consent:new-cycle', async () => {
    await writeConsentRecord(issueId, {
      version: 2,
      generation: randomUUID(),
      status: enabled ? 'granted' : 'spent',
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function claimAutoSpawnConsentForWorkStart(issueId: string): Promise<AutoSpawnConsentClaim | null> {
  return withConsentLock(issueId, 'planning-consent:claim', async () => {
    const current = await readConsentRecordForTransition(issueId);
    if (!current) return null;
    if (current.status !== 'granted') {
      throw new Error(
        `Auto-start consent for ${issueId.toUpperCase()} is unavailable because the current generation is ${current.status}`,
      );
    }
    const claimId = randomUUID();
    await writeConsentRecord(issueId, {
      ...current,
      status: 'claimed',
      claimId,
      updatedAt: new Date().toISOString(),
    });
    return { issueId: issueId.toUpperCase(), generation: current.generation, claimId };
  });
}

async function transitionClaim(
  claim: AutoSpawnConsentClaim,
  status: 'granted' | 'spent',
  writerId: string,
): Promise<void> {
  await withConsentLock(claim.issueId, writerId, async () => {
    const current = await readConsentRecordForTransition(claim.issueId);
    if (!current || current.generation !== claim.generation
      || current.status !== 'claimed' || current.claimId !== claim.claimId) return;
    await writeConsentRecord(claim.issueId, {
      ...current,
      status,
      claimId: undefined,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function completeAutoSpawnConsentClaim(claim: AutoSpawnConsentClaim): Promise<void> {
  await transitionClaim(claim, 'spent', 'planning-consent:complete');
}

export async function releaseAutoSpawnConsentClaim(claim: AutoSpawnConsentClaim): Promise<void> {
  await transitionClaim(claim, 'granted', 'planning-consent:release');
}

export async function withAutoSpawnConsentClaim<T>(
  issueId: string,
  operation: (accept: AcceptAutoSpawnConsent) => Promise<T>,
  options: {
    isAccepted?: (result: T) => boolean;
    logWarning?: (message: string) => void;
  } = {},
): Promise<T> {
  const claim = await claimAutoSpawnConsentForWorkStart(issueId);
  if (!claim) {
    throw new Error(`Auto-start consent for ${issueId.toUpperCase()} is required but no current generation exists`);
  }

  let accepted = false;
  const accept = async (): Promise<void> => {
    if (accepted) return;
    accepted = true;
    try {
      await completeAutoSpawnConsentClaim(claim);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      (options.logWarning ?? console.warn)(
        `[planning] Work start for ${issueId.toUpperCase()} succeeded; consent remains durably claimed because completion persistence failed: ${message}`,
      );
    }
  };

  try {
    const result = await operation(accept);
    if (!accepted) {
      if ((options.isAccepted ?? (() => true))(result)) await accept();
      else await releaseAutoSpawnConsentClaim(claim);
    }
    return result;
  } catch (error) {
    if (!accepted) {
      try {
        await releaseAutoSpawnConsentClaim(claim);
      } catch (releaseError) {
        const message = releaseError instanceof Error ? releaseError.message : String(releaseError);
        (options.logWarning ?? console.warn)(
          `[planning] Work start for ${issueId.toUpperCase()} failed; consent remains fail-closed because claim release failed: ${message}`,
        );
      }
    }
    throw error;
  }
}

