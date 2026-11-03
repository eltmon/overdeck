/**
 * The built `ox` (PAN-4852 WI-6): resolve `<packdir>/<commit>/bin/ox` for the
 * commit the sageox pack trusts. Launches, probes, hooks and doctor use only
 * this binary (AD-7a): there is no fallback to an `ox` on `PATH`, so a missing
 * build resolves to `not-built` with the command that builds it.
 */
import { join } from 'node:path';
import { isOxBuildReady } from '../skill-packs/ox-build.js';
import { getPack, packExtractDir } from '../skill-packs/sources.js';

// Kept local: launch.ts exports SAGEOX_PACK_ID and imports this module.
const PACK_ID = 'sageox';

export type OxBinary =
  | { ok: true; bin: string; binDir: string; commit: string }
  | { ok: false; reason: 'not-registered'; message: string }
  | { ok: false; reason: 'not-built'; commit: string; message: string };

export async function resolveOxBinary(
  deps: { getPack?: typeof getPack; isReady?: typeof isOxBuildReady } = {},
): Promise<OxBinary> {
  const entry = await (deps.getPack ?? getPack)(PACK_ID);
  if (!entry) {
    return {
      ok: false,
      reason: 'not-registered',
      message: 'the sageox pack is not registered; add it with: pan skills pack add sageox',
    };
  }
  const extractDir = packExtractDir(PACK_ID, entry.commit);
  if (!(await (deps.isReady ?? isOxBuildReady)(extractDir, entry.commit))) {
    return {
      ok: false,
      reason: 'not-built',
      commit: entry.commit,
      message: `ox is not built for the sageox pack (${entry.commit.slice(0, 7)}); run pan skills pack sync sageox`,
    };
  }
  const binDir = join(extractDir, 'bin');
  return { ok: true, bin: join(binDir, 'ox'), binDir, commit: entry.commit };
}
