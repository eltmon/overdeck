import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * CRITICAL trust property (counterpart to permission-mode-leak.test.ts):
 *
 * Provisioning code that writes `~/.claude/settings.json` on a remote
 * Fly.io VM MUST consult `buildClaudeUserSettings()` from
 * `claude-permissions.ts` so the file reflects the user's resolved
 * permission mode. Hardcoding `bypassPermissions` in the settings file
 * silently escalates every unflagged `claude` invocation on the VM
 * (interactive shells, future helper scripts) to bypass mode — even
 * when the user has chosen Auto.
 *
 * Pre-fix shape (rejected by this test):
 *   JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } })
 *
 * Post-fix shape (accepted):
 *   JSON.stringify(buildClaudeUserSettings())
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');

const REMOTE_PROVISIONERS = [
  'src/lib/remote/fly-provider.ts',
  'src/cli/commands/workspace-remote.ts',
];

describe('Remote VM provisioning — settings.json must NEVER hardcode bypassPermissions', () => {
  for (const relPath of REMOTE_PROVISIONERS) {
    it(`${relPath} imports buildClaudeUserSettings from claude-permissions`, () => {
      const src = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(
        src,
        `${relPath} must import buildClaudeUserSettings — otherwise it cannot honor the user's Auto setting on the remote VM`,
      ).toMatch(/buildClaudeUserSettings/);
      expect(src).toMatch(/from\s+['"][^'"]*claude-permissions/);
    });

    it(`${relPath} does NOT hardcode 'bypassPermissions' as a string literal`, () => {
      const src = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      // Strip block and line comments before scanning — prose mentions are
      // fine; what we forbid is the token surviving in an emitted JSON/JS
      // string literal in the runtime payload sent to the remote VM.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Look for the token wrapped in any quote style — the shape of a
      // code-emission rather than commentary.
      const quotedBypass = /(['"`])[^'"`\n]*bypassPermissions[^'"`\n]*\1/;
      expect(
        stripped.match(quotedBypass),
        `${relPath}: 'bypassPermissions' must not appear as a string literal in code — use buildClaudeUserSettings(). Found: ${stripped.match(quotedBypass)?.[0]}`,
      ).toBeNull();
    });
  }
});
