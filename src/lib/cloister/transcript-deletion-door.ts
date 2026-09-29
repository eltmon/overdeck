/**
 * The one door through which a native transcript is deleted (PAN-2609 P-9, NFR-10).
 *
 * Both wrappers used to be inlined in `transcript-retention.ts` `defaultDeps`.
 * They live here as a leaf module (imports only `node:fs/promises`) so that the
 * retention sweep and the Session Vault's confirmed eviction share exactly one
 * deletion path, and a test spy on this module sees every transcript removal.
 * Nothing else may call `rm` on a transcript.
 */
import { rm } from 'node:fs/promises';

/** Remove one transcript file. Missing files are not an error. */
export async function removeTranscriptFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Remove a transcript directory tree. Missing trees are not an error. */
export async function removeTranscriptTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
