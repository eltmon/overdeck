import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { installBdAgentShim, isMutatingBdInvocation } from '../../../../src/lib/beads/bd-shim.js';

describe('agent bd mutation shim', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('classifies mutation verbs while preserving read verbs', () => {
    expect(isMutatingBdInvocation(['close', 'x'])).toBe(true);
    expect(isMutatingBdInvocation(['dep', 'add', 'x', 'y'])).toBe(true);
    expect(isMutatingBdInvocation(['dolt', 'push'])).toBe(true);
    expect(isMutatingBdInvocation(['list', '--json'])).toBe(false);
    expect(isMutatingBdInvocation(['dep', 'tree', 'x'])).toBe(false);
  });

  it('installs a PATH shim that rejects mutations and delegates reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'bd-shim-'));
    roots.push(root);
    const real = join(root, 'real-bd');
    writeFileSync(real, '#!/usr/bin/env bash\necho "real:$*"\n', { mode: 0o755 });
    const shim = installBdAgentShim(join(root, 'agent'), real);
    const script = readFileSync(join(shim.binDir, 'bd'), 'utf8');
    expect(shim.pathPrefix.startsWith(shim.binDir)).toBe(true);
    expect(script).toContain('close:*');
    expect(script).toContain('Raw mutating bd commands are blocked');
    expect(script).toContain(`exec '${real}' "$@"`);
  });
});
