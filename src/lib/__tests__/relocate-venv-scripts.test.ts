/**
 * Regression test for relocateVenvScripts().
 *
 * Python venvs are not relocatable: `cp -a` of a venv preserves the source's
 * absolute interpreter path in every bin/* shebang and the activate scripts'
 * VIRTUAL_ENV. After a repo rename (panopticon-cli → overdeck) this broke the
 * TLDR MCP server + read-enforcer silently. relocateVenvScripts rewrites the
 * copy to point at its own python.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { relocateVenvScripts } from '../workspace-manager.js';

let SOURCE: string;
let DEST: string;

function makeFakeVenv(root: string) {
  mkdirSync(join(root, 'bin'), { recursive: true });
  // python3 must exist — the helper refuses to run without it.
  writeFileSync(join(root, 'bin', 'python3'), '');
  return root;
}

beforeEach(() => {
  SOURCE = makeFakeVenv(join(tmpdir(), `venv-src-${Date.now()}-${Math.random()}`));
  DEST = makeFakeVenv(join(tmpdir(), `venv-dst-${Date.now()}-${Math.random()}`));
});

afterEach(() => {
  rmSync(SOURCE, { recursive: true, force: true });
  rmSync(DEST, { recursive: true, force: true });
});

describe('relocateVenvScripts', () => {
  it('rewrites a stale console-script shebang to the dest venv own python', () => {
    // Source venv's script points at the source interpreter (stale after copy).
    const script = join(DEST, 'bin', 'tldr-mcp');
    writeFileSync(script, `#!${SOURCE}/bin/python3\n\nimport llm_tldr\nprint('hi')\n`);

    relocateVenvScripts(SOURCE, DEST);

    const firstLine = readFileSync(script, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe(`#!${DEST}/bin/python3`);
    // Body is preserved verbatim.
    expect(readFileSync(script, 'utf8')).toContain("print('hi')");
  });

  it('leaves scripts whose shebang does not reference the source venv untouched', () => {
    const script = join(DEST, 'bin', 'other');
    const original = '#!/usr/bin/env python3\nprint("untouched")\n';
    writeFileSync(script, original);

    relocateVenvScripts(SOURCE, DEST);

    expect(readFileSync(script, 'utf8')).toBe(original);
  });

  it('repoints the activate VIRTUAL_ENV to the dest venv', () => {
    const activate = join(DEST, 'bin', 'activate');
    writeFileSync(
      activate,
      `export VIRTUAL_ENV="${SOURCE}"\nexport PATH="$VIRTUAL_ENV/bin:$PATH"\n`,
    );

    relocateVenvScripts(SOURCE, DEST);

    const content = readFileSync(activate, 'utf8');
    expect(content).not.toContain(SOURCE);
    expect(content).toContain(`VIRTUAL_ENV="${DEST}"`);
  });

  it('is a no-op when the dest venv has no python3', () => {
    rmSync(join(DEST, 'bin', 'python3'), { force: true });
    const script = join(DEST, 'bin', 'tldr');
    writeFileSync(script, `#!${SOURCE}/bin/python3\nbody\n`);

    relocateVenvScripts(SOURCE, DEST);

    // Unchanged — helper bailed early.
    expect(readFileSync(script, 'utf8').startsWith(`#!${SOURCE}/bin/python3`)).toBe(true);
  });
});
