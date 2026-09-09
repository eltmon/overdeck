import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { shellQuote } from '../shell-quote.js';

describe('Claude launch context delivery', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'overdeck-launch-context-'));
    vi.stubEnv('OVERDECK_HOME', root);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['conversation', 'resume'] as const)('delivers role, layers, and briefing once in %s launches', (spawnMode) => {
    const role = join(root, "role 'special'.md");
    const layers = join(root, 'layers $(touch unsafe).md');
    const briefing = join(root, 'briefing.md');
    const native = join(root, 'CLAUDE.md');
    for (const [file, body] of [[role, 'ROLE_SENTINEL'], [layers, 'LAYER_SENTINEL'], [briefing, 'BRIEFING_SENTINEL'], [native, 'USER_OWNED']]) writeFileSync(file!, body!);
    const harness = join(root, 'harness.cjs');
    writeFileSync(harness, `const fs=require('fs');const args=process.argv.slice(2);const i=args.indexOf('--append-system-prompt-file');fs.writeFileSync(${JSON.stringify(join(root, 'received.json'))},JSON.stringify({args,body:fs.readFileSync(args[i+1],'utf8')}));`);
    const script = generateLauncherScriptSync({
      workingDir: root,
      spawnMode,
      harness: 'claude-code',
      baseCommand: `node ${shellQuote(harness)} --append-system-prompt-file ${shellQuote(role)}`,
      appendSystemPromptFiles: [layers, briefing],
    });
    const launcher = join(root, 'launcher.sh');
    writeFileSync(launcher, script);
    execFileSync('bash', [launcher], { cwd: root, timeout: 10000 });
    const received = JSON.parse(readFileSync(join(root, 'received.json'), 'utf8'));
    expect(received.args.filter((arg: string) => arg === '--append-system-prompt-file')).toHaveLength(1);
    for (const sentinel of ['ROLE_SENTINEL', 'LAYER_SENTINEL', 'BRIEFING_SENTINEL']) expect(received.body.split(sentinel)).toHaveLength(2);
    expect(received.body).toContain(`Source: ${role}`);
    expect(readFileSync(native, 'utf8')).toBe('USER_OWNED');
    expect(existsSync(join(root, 'unsafe'))).toBe(false);
  });

  it('combines every OMP layer and the role prompt into its single append argument', () => {
    const first = join(root, 'global.md');
    const second = join(root, 'briefing.md');
    writeFileSync(first, 'GLOBAL_SENTINEL');
    writeFileSync(second, 'BRIEFING_SENTINEL');
    const output = join(root, 'omp-received.json');
    writeFileSync(join(root, 'omp'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));`, { mode: 0o755 });
    vi.stubEnv('PATH', `${root}:${process.env.PATH}`);
    const launcher = join(root, 'omp-launcher.sh');
    writeFileSync(launcher, generateLauncherScriptSync({
      workingDir: root, spawnMode: 'conversation', harness: 'ohmypi',
      piMode: 'tui', piSessionDir: join(root, 'sessions'),
      appendSystemPromptFiles: [first, second], promptInline: 'ROLE_SENTINEL',
    }));
    execFileSync('bash', [launcher], { cwd: root, timeout: 10000 });
    const args: string[] = JSON.parse(readFileSync(output, 'utf8'));
    expect(args.filter(arg => arg === '--append-system-prompt')).toHaveLength(1);
    const body = args[args.indexOf('--append-system-prompt') + 1]!;
    for (const sentinel of ['GLOBAL_SENTINEL', 'BRIEFING_SENTINEL', 'ROLE_SENTINEL']) expect(body.split(sentinel)).toHaveLength(2);
  });

  it('does not start the harness when an instruction source is missing', () => {
    const marker = join(root, 'started');
    const script = generateLauncherScriptSync({
      workingDir: root,
      spawnMode: 'conversation',
      baseCommand: `touch ${shellQuote(marker)}`,
      appendSystemPromptFiles: [join(root, 'missing.md')],
    });
    const launcher = join(root, 'launcher.sh');
    writeFileSync(launcher, script);
    expect(() => execFileSync('bash', [launcher], { cwd: root, stdio: 'pipe' })).toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});
