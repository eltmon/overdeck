/**
 * A fake `claude` for the AC-1 two-machine test (PAN-4774 WI-2).
 *
 * `installFakeClaude(home, nodePath)` writes `<home>/bin/claude` and its JSONL
 * writer. The fake answers `--version` with `2.1.0 (Claude Code)`. Otherwise it
 * writes a Claude-shaped transcript at
 * `$HOME/.claude/projects/<encoded cwd>/<id>.jsonl` (created for
 * `--session-id`, appended for `--resume`), prints a `❯ ` prompt, and for each
 * stdin line logs the text to `<home>/fake-claude-input.log` (an absolute path
 * baked into the script, because a dashboard's `HOME` may be a subdirectory of
 * `<home>`) and appends a user line and an assistant line `fake-reply:<text>`.
 * It never exits on its own.
 *
 * The script is named `claude` so the liveness oracle sees a `claude` process.
 * Lines carry no `model`, so no cost is attributed to the fake.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const WRITER = `import { appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const [mode, sessionId, cwd, text] = process.argv.slice(2);
const dir = join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
mkdirSync(dir, { recursive: true });
const line = (type, content) => JSON.stringify({
  type,
  uuid: randomUUID(),
  sessionId,
  cwd,
  timestamp: new Date().toISOString(),
  message: { role: type, content },
});
const pair = (prompt, reply) => line('user', prompt) + '\\n' + line('assistant', [{ type: 'text', text: reply }]) + '\\n';
const file = join(dir, sessionId + '.jsonl');
if (mode === 'init') appendFileSync(file, pair('fake-claude session start', 'fake-claude ready'));
else if (mode === 'turn') appendFileSync(file, pair(text, 'fake-reply:' + text));
else throw new Error('fake-claude-writer: unknown mode ' + mode);
`;

function claudeScript(nodePath: string, inputLog: string): string {
  return `#!/bin/sh
NODE=${shellQuote(nodePath)}
LOG=${shellQuote(inputLog)}
dir=$(dirname "$(readlink -f "$0")")
case "$1" in --version|-v|version) echo "2.1.0 (Claude Code)"; exit 0 ;; esac
id=""
mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) id="$2"; mode=init; shift 2 || shift ;;
    --resume) id="$2"; mode=resume; shift 2 || shift ;;
    *) shift ;;
  esac
done
if [ "$mode" = init ]; then "$NODE" "$dir/fake-claude-writer.mjs" init "$id" "$PWD"; fi
esc=$(printf '\\033')
cr=$(printf '\\r')
printf '\\342\\235\\257 '
while IFS= read -r line; do
  line=$(printf '%s' "$line" | sed -e "s/\${esc}\\[20[01]~//g" -e "s/\${cr}//g")
  printf '%s\\n' "$line" >> "$LOG"
  if [ -n "$id" ]; then "$NODE" "$dir/fake-claude-writer.mjs" turn "$id" "$PWD" "$line"; fi
  printf '\\342\\235\\257 '
done
while :; do sleep 3600; done
`;
}

export function installFakeClaude(home: string, nodePath: string): { binDir: string; inputLog: string } {
  const binDir = join(home, 'bin');
  const inputLog = join(home, 'fake-claude-input.log');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'fake-claude-writer.mjs'), WRITER);
  writeFileSync(join(binDir, 'claude'), claudeScript(nodePath, inputLog), { mode: 0o755 });
  return { binDir, inputLog };
}
