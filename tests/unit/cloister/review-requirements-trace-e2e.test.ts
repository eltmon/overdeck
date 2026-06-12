import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLauncherScriptSync, type LauncherConfig } from '../../../src/lib/launcher-generator.js';

describe('requirements trace launcher e2e', () => {
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-trace-e2e-'));
    prevHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function buildFixtureDirs(root: string) {
    const binDir = join(root, 'bin');
    const agentDir = join(root, 'agent-pan-1-review-requirements');
    const promptFile = join(agentDir, 'initial-prompt.md');
    const outputFile = join(agentDir, 'review-requirements.md');
    const signalMarker = join(agentDir, 'reviewer-signaled');
    const pidFile = join(agentDir, 'reviewer-launcher.pid');
    const tellLog = join(agentDir, 'tell.log');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    return { binDir, promptFile, outputFile, signalMarker, pidFile, tellLog };
  }

  function writeStubs(paths: ReturnType<typeof buildFixtureDirs>, fixture: 'fail' | 'pass') {
    // claude stub: copy the requested fixture to the reviewer output path and exit 0.
    const claudeStub = `#!/bin/bash\n# Ignore all args; just copy the fixture to the expected output path.\ncp "${process.cwd()}/tests/fixtures/review-requirements/${fixture === 'fail' ? 'missing-section' : 'happy-path'}.md" "${paths.outputFile}"\nexit 0\n`;
    writeFileSync(join(paths.binDir, 'claude'), claudeStub, { mode: 0o755 });

    // pan stub: a tsx script that actually validates traces and records tells.
    // The file has no extension, so Node treats it as CommonJS; use require().
    const panStub = `#!/usr/bin/env tsx\nconst fs = require('node:fs');\nconst { validateRequirementsTrace } = require('${process.cwd()}/src/lib/cloister/review-requirements-validator.ts');\nconst args = process.argv.slice(2);\nif (args[0] === 'tell') {\n  const message = args.slice(2).join(' ');\n  fs.appendFileSync('${paths.tellLog}', message + '\\n');\n  process.exit(0);\n}\nif (args[0] === 'review' && args[1] === 'validate-trace') {\n  const content = fs.readFileSync(args[2], 'utf8');\n  const result = validateRequirementsTrace(content);\n  if (result.ok) {\n    process.exit(0);\n  }\n  process.stderr.write(result.reason);\n  process.exit(1);\n}\nprocess.exit(0);\n`;
    writeFileSync(join(paths.binDir, 'pan'), panStub, { mode: 0o755 });

    writeFileSync(paths.promptFile, '# prompt\n');
  }

  function generateScript(outputFile: string, signalMarker: string, pidFile: string): string {
    return generateLauncherScriptSync({
      role: 'review',
      workingDir: process.cwd(),
      promptFile: '/dev/null',
      promptFileMode: 'stdin',
      setPipefail: true,
      trapHup: true,
      baseCommand: 'claude --print',
      sessionId: 'sess-req',
      reviewSignal: {
        synthesisAgentId: 'agent-pan-1-review',
        subRole: 'requirements',
        outputPath: outputFile,
        signalMarkerPath: signalMarker,
        launcherPidPath: pidFile,
        timeoutSeconds: 1800,
      },
    });
  }

  function testPath(paths: ReturnType<typeof buildFixtureDirs>): string {
    return `${paths.binDir}:${process.cwd()}/node_modules/.bin:/usr/bin:/bin`;
  }

  it('signals REVIEWER_FAILED with the validator reason for a missing-trace fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-fail-'));
    const paths = buildFixtureDirs(root);
    writeStubs(paths, 'fail');

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    runLauncherScript(script, root, testPath(paths));

    const tells = readTellLog(paths.tellLog);
    expect(tells).toHaveLength(1);
    expect(tells[0]).toMatch(/^REVIEWER_FAILED requirements requirements review missing live code path trace for ACs:/);
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('signals REVIEWER_READY for a valid-trace fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-pass-'));
    const paths = buildFixtureDirs(root);
    writeStubs(paths, 'pass');

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    runLauncherScript(script, root, testPath(paths));

    const tells = readTellLog(paths.tellLog);
    expect(tells).toHaveLength(1);
    expect(tells[0]).toBe(`REVIEWER_READY requirements ${paths.outputFile}`);
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to REVIEWER_READY with a warning when pan is not on PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-fallback-'));
    const paths = buildFixtureDirs(root);

    // Only claude stub, no pan stub.
    const claudeStub = `#!/bin/bash\ncp "${process.cwd()}/tests/fixtures/review-requirements/missing-section.md" "${paths.outputFile}"\nexit 0\n`;
    writeFileSync(join(paths.binDir, 'claude'), claudeStub, { mode: 0o755 });
    writeFileSync(paths.promptFile, '# prompt\n');

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    const output = runLauncherScript(script, root, `${paths.binDir}:/usr/bin:/bin`);

    expect(output).toContain('substrate trace check skipped');
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

function runLauncherScript(script: string, root: string, pathEnv: string): string {
  const scriptPath = join(root, 'launcher.sh');
  writeFileSync(scriptPath, script, { mode: 0o755 });
  const result = spawnSync('bash', [scriptPath], {
    env: { ...process.env, PATH: pathEnv },
    timeout: 5000,
  });
  return (result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '');
}

function readTellLog(path: string): string[] {
  try {
    const content = require('node:fs').readFileSync(path, 'utf8');
    return content.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
