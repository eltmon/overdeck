import { Effect } from 'effect';
import { afterEach, describe, expect, test } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBeadsFromVBrief } from '../../src/lib/vbrief/beads.js';
import type { VBriefDocument } from '../../src/lib/vbrief/types.js';

const realBd = commandPath('bd');
const bdDoctorFixSupportsEmbedded = realBd ? checkEmbeddedDoctorFixSupport() : false;
const tempRoots: string[] = [];

// Make the skip LOUD rather than silent (PAN-1450 review). The real-corruption
// recovery path exercised below depends on `bd doctor --fix` working in embedded
// mode; bd ≤ 1.0.4 reports "not yet supported in embedded mode", so the test can
// only run once bd ships embedded doctor --fix. Surface that in CI logs so the
// coverage gap is visible instead of vanishing into a silently-skipped case.
if (!realBd) {
  console.warn('[PAN-1111] Skipping real Dolt-corruption recovery test: `bd` binary not found on PATH.');
} else if (!bdDoctorFixSupportsEmbedded) {
  console.warn(
    '[PAN-1111] Skipping real Dolt-corruption recovery test: installed `bd` does not support ' +
    '`bd doctor --fix` in embedded mode. Real auto-recovery coverage is blocked on bd gaining ' +
    'embedded doctor --fix support; this test runs automatically once it does.',
  );
}

function commandPath(command: string): string | null {
  const result = spawnSync('which', [command], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function checkEmbeddedDoctorFixSupport(): boolean {
  const root = join(tmpdir(), `pan-1111-doctor-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  try {
    const init = spawnSync('bd', ['init', '--prefix', 'tst'], { cwd: root, encoding: 'utf-8' });
    if (init.status !== 0) return false;
    const doctor = spawnSync('bd', ['doctor', '--fix'], { cwd: root, encoding: 'utf-8' });
    const output = `${doctor.stdout}\n${doctor.stderr}`;
    return doctor.status === 0 && !output.includes('not yet supported in embedded mode');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeTempWorkspace(issueId: string): { root: string; workspace: string } {
  const root = join(tmpdir(), `pan-1111-beads-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const workspace = join(root, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(workspace, { recursive: true });
  tempRoots.push(root);
  return { root, workspace };
}

function makeDoc(issueId: string): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: issueId,
      title: `${issueId} corruption recovery`,
      status: 'active',
      items: [
        {
          id: 'item-1',
          title: 'Recovered real corruption task',
          status: 'pending',
          metadata: { difficulty: 'simple', issueLabel: issueId.toLowerCase() },
        },
      ],
      edges: [],
    },
  };
}

function writeWorkspacePlan(workspace: string, doc: VBriefDocument): void {
  const panDir = join(workspace, '.pan');
  mkdirSync(panDir, { recursive: true });
  writeFileSync(join(panDir, 'spec.vbrief.json'), JSON.stringify(doc, null, 2));
}

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function findDoltManifest(workspace: string): string {
  const beadsDir = join(workspace, '.beads');
  const manifest = walkFiles(beadsDir).find(path => basename(path).toLowerCase().includes('manifest'));
  if (!manifest) {
    throw new Error(`bd init did not create a Dolt manifest under ${beadsDir}`);
  }
  return manifest;
}

function runBd(workspace: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync('bd', args, { cwd: workspace, env, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`bd ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

function installBdRecorder(root: string, realBdPath: string): { binDir: string; logPath: string; env: NodeJS.ProcessEnv } {
  const binDir = join(root, 'bin');
  const logPath = join(root, 'bd-commands.log');
  const wrapperPath = join(binDir, 'bd');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(wrapperPath, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${logPath}"\nexec "${realBdPath}" "$@"\n`);
  chmodSync(wrapperPath, 0o755);
  return {
    binDir,
    logPath,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
  };
}

function readBdCommands(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('createBeadsFromVBrief real bd corruption recovery (PAN-1111)', () => {
  test.skipIf(!realBd || !bdDoctorFixSupportsEmbedded)('repairs real Dolt manifest corruption once and then stays healthy', async () => {
    const issueId = 'TST-1111';
    const { root, workspace } = makeTempWorkspace(issueId);
    writeWorkspacePlan(workspace, makeDoc(issueId));

    runBd(workspace, ['init', '--prefix', 'tst']);
    runBd(workspace, ['config', 'set', 'export.git-add', 'false']);

    truncateSync(findDoltManifest(workspace), 0);

    const recorder = installBdRecorder(root, realBd!);
    const oldPath = process.env.PATH;
    process.env.PATH = recorder.env.PATH;
    try {
      for (let cycle = 0; cycle < 5; cycle += 1) {
        const result = await Effect.runPromise(createBeadsFromVBrief(workspace));
        expect(result.success, `cycle ${cycle + 1} errors: ${result.errors.join('; ')}`).toBe(true);
        expect(result.created).toHaveLength(1);
      }
    } finally {
      process.env.PATH = oldPath;
    }

    const commands = readBdCommands(recorder.logPath);
    const doctorFixCalls = commands.filter(command => command === 'doctor --fix');
    const initCalls = commands.filter(command => command.startsWith('init'));

    expect(doctorFixCalls, 'corruption recovery should be sticky after the first repair').toHaveLength(1);
    expect(initCalls, 'existing .beads/ must be recovered, not reinitialized').toHaveLength(0);
  });
});
