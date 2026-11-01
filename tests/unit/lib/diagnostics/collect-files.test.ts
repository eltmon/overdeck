import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectFiles } from '../../../../src/lib/diagnostics/collect-files.js';

let root: string;
let overdeckHome: string;
let logsDir: string;
let skillDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overdeck-diagnostics-files-'));
  overdeckHome = join(root, 'home');
  logsDir = join(overdeckHome, 'logs');
  skillDir = join(root, 'skills');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeDirs(): Promise<void> {
  await mkdir(overdeckHome, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(skillDir, { recursive: true });
}

describe('collectFiles', () => {
  it('records a failure (not a throw) when config.yaml is missing', async () => {
    await makeDirs();
    await writeFile(join(overdeckHome, 'projects.yaml'), 'projects: {}\n');

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'missing.md') });

    expect(outcome.failures).toContainEqual({ source: 'config/config.yaml', reason: 'not found' });
    const projectsEntry = outcome.entries.find((e) => e.path === 'config/projects.yaml');
    expect(projectsEntry?.kind).toBe('config');
  });

  it('marks both config entries with kind "config"', async () => {
    await makeDirs();
    await writeFile(join(overdeckHome, 'config.yaml'), 'dashboard:\n  api_port: 3011\n');
    await writeFile(join(overdeckHome, 'projects.yaml'), 'projects: {}\n');

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'missing.md') });

    const configEntry = outcome.entries.find((e) => e.path === 'config/config.yaml');
    const projectsEntry = outcome.entries.find((e) => e.path === 'config/projects.yaml');
    expect(configEntry?.kind).toBe('config');
    expect(projectsEntry?.kind).toBe('config');
  });

  it('tails a large log to at most 48KiB, at most 200 lines, ending with the file\'s last line', async () => {
    await makeDirs();
    const lineCount = 6000;
    const lines = Array.from({ length: lineCount }, (_, i) => `line ${i} ${'x'.repeat(40)}`);
    const lastLine = lines[lines.length - 1];
    await writeFile(join(logsDir, 'dashboard.log'), `${lines.join('\n')}\n`);

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'missing.md') });
    const entry = outcome.entries.find((e) => e.path === 'logs/dashboard.log');
    expect(entry).toBeDefined();

    const bytes = Buffer.byteLength(entry!.content, 'utf-8');
    expect(bytes).toBeLessThanOrEqual(48 * 1024);

    const resultLines = entry!.content.split('\n').filter((_, idx, arr) => !(idx === arr.length - 1 && arr[idx] === ''));
    expect(resultLines.length).toBeLessThanOrEqual(200);
    expect(resultLines[resultLines.length - 1]).toBe(lastLine);
  });

  it('includes present core logs and only the 3 newest other logs', async () => {
    await makeDirs();
    await writeFile(join(logsDir, 'dashboard.log'), 'dashboard\n');
    await writeFile(join(logsDir, 'supervisor.log'), 'supervisor\n');

    const otherNames = ['bridge-a.log', 'bridge-b.log', 'bridge-c.log', 'bridge-d.log', 'bridge-e.jsonl'];
    const base = Date.now() / 1000;
    for (let i = 0; i < otherNames.length; i++) {
      const filePath = join(logsDir, otherNames[i]);
      await writeFile(filePath, `${otherNames[i]}\n`);
      // Stagger mtimes so the newest-3 selection is deterministic (bridge-e newest).
      await utimes(filePath, base + i, base + i);
    }

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'missing.md') });
    const logPaths = outcome.entries.filter((e) => e.path.startsWith('logs/')).map((e) => e.path).sort();

    expect(logPaths).toEqual([
      'logs/bridge-c.log',
      'logs/bridge-d.log',
      'logs/bridge-e.jsonl',
      'logs/dashboard.log',
      'logs/supervisor.log',
    ]);
  });

  it('skips a symlink in the logs directory', async () => {
    await makeDirs();
    const realFile = join(logsDir, 'real.log');
    await writeFile(realFile, 'real content\n');
    await symlink(realFile, join(logsDir, 'link.log'));

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'missing.md') });
    const logPaths = outcome.entries.filter((e) => e.path.startsWith('logs/')).map((e) => e.path);

    expect(logPaths).toContain('logs/real.log');
    expect(logPaths).not.toContain('logs/link.log');
  });

  it('copies the troubleshooting skill when skillPath exists', async () => {
    await makeDirs();
    await writeFile(join(skillDir, 'SKILL.md'), '# pan-diagnose\n');

    const outcome = await collectFiles({ overdeckHome, logsDir, skillPath: join(skillDir, 'SKILL.md') });
    const entry = outcome.entries.find((e) => e.path === 'TROUBLESHOOTING.md');
    expect(entry?.content).toBe('# pan-diagnose\n');
  });
});
