import { exec } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export function isMutatingBdInvocation(args: readonly string[]): boolean {
  const [verb = '', subverb = ''] = args;
  if (['create', 'update', 'close', 'delete', 'import', 'init', 'migrate', 'batch'].includes(verb)) return true;
  if (verb === 'dep' && ['add', 'remove'].includes(subverb)) return true;
  if (verb === 'dolt' && ['push', 'commit', 'reset'].includes(subverb)) return true;
  if (verb === 'config' && ['set', 'unset'].includes(subverb)) return true;
  if (verb === 'comments' && ['add', 'delete'].includes(subverb)) return true;
  return verb === 'admin' && subverb === 'compact';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function installBdAgentShim(agentDir: string, realBdPath: string): { binDir: string; pathPrefix: string } {
  const binDir = join(agentDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const path = join(binDir, 'bd');
  const script = `#!/usr/bin/env bash
set -euo pipefail
verb="\${1:-}"
subverb="\${2:-}"
case "$verb:$subverb" in
  create:*|update:*|close:*|delete:*|import:*|init:*|migrate:*|batch:*|dep:add|dep:remove|dolt:push|dolt:commit|dolt:reset|config:set|config:unset|comments:add|comments:delete|admin:compact)
    echo "Raw mutating bd commands are blocked in agent sessions. Use pan beads claim|update|close|create|dep|delete so the canonical writer pulls, validates, exports, and pushes durably." >&2
    exit 64
    ;;
esac
exec ${shellQuote(realBdPath)} "$@"
`;
  writeFileSync(path, script, { mode: 0o755 });
  chmodSync(path, 0o755);
  return { binDir, pathPrefix: `${binDir}${delimiter}${process.env.PATH ?? ''}` };
}

export async function resolveBdAgentShimPath(agentDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync('command -v bd', { encoding: 'utf8' });
    const realBd = stdout.trim();
    return realBd ? installBdAgentShim(agentDir, realBd).pathPrefix : undefined;
  } catch {
    return undefined;
  }
}
