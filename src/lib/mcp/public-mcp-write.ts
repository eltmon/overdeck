/**
 * Write door for `mcp.public.enabled` (PAN-4947 D-3); mirrors color-themes/selection-write.ts.
 * Only that one node is edited with `setIn`, so every other node in config.yaml (comments,
 * unrelated keys) keeps its text. The gate sees the new value on its next request.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, parseDocument, type Document } from 'yaml';

import { clearConfigCache } from '../config-yaml/load.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { getOverdeckHome } from '../paths.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import { invalidatePublicMcpConfig } from './public-mcp.js';

/** Replace a present non-map node with an empty map so the next `setIn` cannot throw. */
function ensureMapAt(doc: Document, path: readonly string[]): void {
  const existing = doc.getIn(path);
  if (existing !== undefined && !isMap(existing)) {
    doc.setIn(path, doc.createNode({}));
  }
}

export function savePublicMcpEnabled(enabled: boolean): Promise<void> {
  const path = join(getOverdeckHome(), 'config.yaml');
  return runSettingsWriteSerialized(async () => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    const doc = parseDocument(text);
    ensureMapAt(doc, ['mcp']);
    ensureMapAt(doc, ['mcp', 'public']);
    doc.setIn(['mcp', 'public', 'enabled'], enabled);
    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
    invalidatePublicMcpConfig();
  });
}
