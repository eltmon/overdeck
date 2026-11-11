/**
 * One-time Claude permission-mode pin (PAN-5151). The 'auto' default now
 * applies only to new installations; this module decides, once per Overdeck
 * home, whether an existing installation keeps resolving 'bypass' by writing
 * it explicitly into config.yaml. See PRD .pan/drafts/PAN-5151.md WI-1.
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { OVERDECK_HOME } from './paths.js';
import { OVERDECK_DB_FILENAME } from './overdeck/paths.js';
import { writeFileAtomic } from './model-presets/state.js';

export type ClaudePermissionPinOutcome =
  | 'already-decided'
  | 'new-install'
  | 'pinned-bypass'
  | 'already-set'
  | 'skipped-unparseable'
  | 'skipped-error'
  | 'skipped-test-runner';

export interface ClaudePermissionPinResult {
  outcome: ClaudePermissionPinOutcome;
  replacedValue?: unknown;
  notice?: string;
}

/** Never throws. Decides once per Overdeck home (marker), see PRD PAN-5151. */
export async function pinClaudePermissionModeOnce(
  opts: { overdeckHome?: string } = {},
): Promise<ClaudePermissionPinResult> {
  if (!opts.overdeckHome && process.env.VITEST) {
    return { outcome: 'skipped-test-runner' };
  }
  const home = opts.overdeckHome ?? OVERDECK_HOME;
  const marker = join(home, '.claude-permission-mode-pin.json');
  const yamlPath = join(home, 'config.yaml');
  const tomlPath = join(home, 'config.toml');
  const dbPath = join(home, OVERDECK_DB_FILENAME);

  try {
    try {
      await stat(marker);
      return { outcome: 'already-decided' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    if (!existsSync(yamlPath) && !existsSync(tomlPath) && !existsSync(dbPath)) {
      await writeMarker(marker, 'new-install');
      return { outcome: 'new-install' };
    }

    const { parseDocument, isMap } = await import('yaml');
    let text: string;
    try {
      text = await readFile(yamlPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      return { outcome: 'skipped-unparseable' };
    }

    const current = doc.getIn(['claude', 'permissionMode']);
    if (current === 'auto' || current === 'bypass') {
      await writeMarker(marker, 'already-set');
      return { outcome: 'already-set' };
    }

    // A non-map `claude:` (e.g. `claude: bypassPermissions`, a scalar) makes
    // `getIn(['claude', 'permissionMode'])` read as undefined even though the
    // key held a value — name that scalar as the replaced value instead of
    // reporting "absent".
    const claudeNode = doc.getIn(['claude']);
    const replacedValue = current !== undefined
      ? current
      : (claudeNode !== undefined && !isMap(claudeNode) ? claudeNode : undefined);
    if (claudeNode !== undefined && !isMap(claudeNode)) {
      doc.setIn(['claude'], doc.createNode({}));
    }
    doc.setIn(['claude', 'permissionMode'], 'bypass');
    await writeFileAtomic(yamlPath, doc.toString({ lineWidth: 120 }), 0o600);

    const notice = `Overdeck: kept this installation on claude.permissionMode: bypass `
      + `(written to ${yamlPath}). New installations now default to auto; `
      + `change it in Settings → Permissions.`
      + (replacedValue === undefined ? '' : ` (replaced invalid value ${JSON.stringify(replacedValue)})`);
    await writeMarker(marker, 'pinned-bypass', replacedValue);
    return { outcome: 'pinned-bypass', replacedValue, notice };
  } catch {
    return { outcome: 'skipped-error' };
  }
}

async function writeMarker(marker: string, outcome: ClaudePermissionPinOutcome, replacedValue?: unknown): Promise<void> {
  const record: Record<string, unknown> = { decidedAt: new Date().toISOString(), outcome };
  if (replacedValue !== undefined) record.replacedValue = replacedValue;
  await writeFileAtomic(marker, `${JSON.stringify(record)}\n`, 0o600);
}
