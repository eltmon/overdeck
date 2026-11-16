import { describe, expect, it, vi } from 'vitest';

import {
  buildSemgrepArgv,
  classifySemgrepExit,
  decideSastGate,
  detectSuppressionChanges,
  filterFindingsToAddedLines,
  localRulePaths,
  normalizeSemgrepSeverity,
  parseSemgrepJson,
  parseUnifiedDiff,
  resolveSastGateMode,
  sastFindingsForReview,
  severityMeetsThreshold,
  type SastFinding,
  type SastGateInput,
  type SastLatestRecord,
} from '../../../../src/lib/cloister/sast-gate.js';

const finding = (over: Partial<SastFinding> = {}): SastFinding => ({
  path: 'src/app.py',
  startLine: 3,
  endLine: 3,
  ruleId: 'python.lang.security.shell-true',
  severity: 'ERROR',
  message: 'avoid shell=True',
  ...over,
});

const input = (over: Partial<SastGateInput> = {}): SastGateInput => ({
  mode: 'advisory',
  severity: 'ERROR',
  configs: ['p/default'],
  findings: [],
  suppressions: [],
  repos: [{ repoKey: 'repo', head: 'abc', status: 'scanned' }],
  durationMs: 5,
  ...over,
});

describe('resolveSastGateMode', () => {
  it('is off while Semgrep is disabled, whatever the project override says', () => {
    expect(resolveSastGateMode({ enabled: false, gate: 'blocking' }, 'blocking').mode).toBe('off');
  });

  it('uses the global gate mode when the project has no override', () => {
    expect(resolveSastGateMode({ enabled: true, gate: 'advisory' }, undefined)).toEqual({
      mode: 'advisory',
      reason: 'security.semgrep.gate: advisory',
    });
  });

  it('lets verification.sast override the global mode', () => {
    expect(resolveSastGateMode({ enabled: true, gate: 'advisory' }, 'blocking').mode).toBe('blocking');
    expect(resolveSastGateMode({ enabled: true, gate: 'blocking' }, 'off').mode).toBe('off');
  });

  it('ignores an invalid override with a warning and never reads it as blocking', () => {
    const warn = vi.fn();
    expect(resolveSastGateMode({ enabled: true, gate: 'advisory' }, 'strict', warn).mode).toBe('advisory');
    expect(resolveSastGateMode({ enabled: true, gate: 'advisory' }, true, warn).mode).toBe('advisory');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('buildSemgrepArgv', () => {
  it('passes each config, JSON output, metrics off, --error, then targets after --', () => {
    expect(buildSemgrepArgv(['p/default', 'rules/'], ['src/a.ts', '-weird.ts'])).toEqual([
      'scan', '--config', 'p/default', '--config', 'rules/', '--json', '--metrics', 'off', '--error', '--', 'src/a.ts', '-weird.ts',
    ]);
  });

  it('never uses baseline mode or Semgrep severity filtering', () => {
    const argv = buildSemgrepArgv(['p/default'], ['a.py']);
    expect(argv).not.toContain('--baseline-commit');
    expect(argv).not.toContain('--severity');
  });
});

describe('classifySemgrepExit', () => {
  it('maps 0 to clean, 1 to findings and anything else to error', () => {
    expect(classifySemgrepExit(0)).toBe('clean');
    expect(classifySemgrepExit(1)).toBe('findings');
    for (const code of [2, 4, 5, 7, 13, null]) expect(classifySemgrepExit(code)).toBe('error');
  });
});

describe('severity', () => {
  it('maps current and newer labels onto INFO/WARNING/ERROR', () => {
    expect(normalizeSemgrepSeverity('ERROR')).toBe('ERROR');
    expect(normalizeSemgrepSeverity('CRITICAL')).toBe('ERROR');
    expect(normalizeSemgrepSeverity('high')).toBe('ERROR');
    expect(normalizeSemgrepSeverity('MEDIUM')).toBe('WARNING');
    expect(normalizeSemgrepSeverity('WARNING')).toBe('WARNING');
    expect(normalizeSemgrepSeverity('LOW')).toBe('INFO');
    expect(normalizeSemgrepSeverity('INFO')).toBe('INFO');
    expect(normalizeSemgrepSeverity('EXPERIMENT')).toBe('WARNING');
    expect(normalizeSemgrepSeverity(undefined)).toBe('WARNING');
  });

  it('compares against the threshold', () => {
    expect(severityMeetsThreshold('ERROR', 'ERROR')).toBe(true);
    expect(severityMeetsThreshold('WARNING', 'ERROR')).toBe(false);
    expect(severityMeetsThreshold('WARNING', 'WARNING')).toBe(true);
    expect(severityMeetsThreshold('INFO', 'WARNING')).toBe(false);
    expect(severityMeetsThreshold('INFO', 'INFO')).toBe(true);
  });
});

describe('parseSemgrepJson', () => {
  it('reads results into findings', () => {
    const stdout = JSON.stringify({
      version: '1.180.0',
      results: [{
        check_id: 'rule.a',
        path: './sub/app.py',
        start: { line: 3, col: 5, offset: 40 },
        end: { line: 4, col: 1, offset: 60 },
        extra: { message: 'avoid shell=True', severity: 'HIGH', fix: 'shell=False', lines: 'requires login' },
      }],
      errors: [],
    });
    expect(parseSemgrepJson(stdout)).toEqual([{
      path: 'sub/app.py',
      startLine: 3,
      endLine: 4,
      ruleId: 'rule.a',
      severity: 'ERROR',
      message: 'avoid shell=True',
      fix: 'shell=False',
    }]);
  });

  it('returns null for output that is not a Semgrep report', () => {
    expect(parseSemgrepJson('Traceback (most recent call last)')).toBeNull();
    expect(parseSemgrepJson('{"errors": []}')).toBeNull();
    expect(parseSemgrepJson('null')).toBeNull();
  });

  it('skips malformed results', () => {
    expect(parseSemgrepJson(JSON.stringify({ results: [null, { path: 'a' }, { path: 'b', start: { line: 1 } }] })))
      .toEqual([{ path: 'b', startLine: 1, endLine: 1, ruleId: 'unknown-rule', severity: 'WARNING', message: '' }]);
  });
});

const DIFF = [
  'diff --git a/src/app.py b/src/app.py',
  'index 111..222 100644',
  '--- a/src/app.py',
  '+++ b/src/app.py',
  '@@ -2,0 +3,2 @@ def f(x):',
  '+    subprocess.call(x, shell=True)  # nosemgrep: rule.a',
  '++++ looks like a header',
  '@@ -10 +11,0 @@',
  '-removed',
  'diff --git a/.semgrepignore b/.semgrepignore',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/.semgrepignore',
  '@@ -0,0 +1 @@',
  '+src/',
  'diff --git a/rules/custom.yml b/rules/custom.yml',
  'deleted file mode 100644',
  '--- a/rules/custom.yml',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-rules:',
  '-  - id: x',
  'diff --git a/old.py b/new.py',
  'similarity index 100%',
  'rename from old.py',
  'rename to new.py',
  '',
].join('\n');

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(DIFF);

  it('records added lines by new-file line number, consuming hunks by count', () => {
    expect(files[0]).toEqual({
      oldPath: 'src/app.py',
      newPath: 'src/app.py',
      added: [
        { line: 3, text: '    subprocess.call(x, shell=True)  # nosemgrep: rule.a' },
        { line: 4, text: '+++ looks like a header' },
      ],
    });
  });

  it('tracks added, deleted and renamed files', () => {
    expect(files[1]).toMatchObject({ oldPath: null, newPath: '.semgrepignore', added: [{ line: 1, text: 'src/' }] });
    expect(files[2]).toMatchObject({ oldPath: 'rules/custom.yml', newPath: null, added: [] });
    expect(files[3]).toMatchObject({ oldPath: 'old.py', newPath: 'new.py', added: [] });
  });

  it('unquotes paths git quoted', () => {
    const quoted = parseUnifiedDiff('diff --git "a/sp ace\\tx.py" "b/sp ace\\tx.py"\n--- "a/sp ace\\tx.py"\n+++ "b/sp ace\\tx.py"\n@@ -1 +1 @@\n-a\n+b\n');
    expect(quoted[0]).toMatchObject({ newPath: 'sp ace\tx.py', added: [{ line: 1, text: 'b' }] });
  });
});

describe('filterFindingsToAddedLines', () => {
  const files = parseUnifiedDiff(DIFF);

  it('keeps findings that overlap an added line and drops the rest', () => {
    const kept = filterFindingsToAddedLines([
      finding({ startLine: 3, endLine: 3 }),
      finding({ startLine: 1, endLine: 4, ruleId: 'spans' }),
      finding({ startLine: 5, endLine: 9, ruleId: 'unchanged' }),
      finding({ path: 'other.py', ruleId: 'untouched-file' }),
    ], files);
    expect(kept.map((f) => f.ruleId)).toEqual(['python.lang.security.shell-true', 'spans']);
  });
});

describe('suppression detection (FR-10)', () => {
  it('treats registry ids as remote and other configs as repo-local rule paths', () => {
    expect(localRulePaths(['p/default', 'r/python.x', 'auto', 'https://x/y.yml', './rules/', 'semgrep.yml', '/abs/rules']))
      .toEqual(['rules', 'semgrep.yml', '.semgrep.yml', '.semgrep.yaml', '.semgrep']);
    expect(localRulePaths(['.semgrep/'])).toEqual(['.semgrep', '.semgrep.yml', '.semgrep.yaml']);
  });

  it('lists added nosemgrep comments, .semgrepignore edits and local rule changes', () => {
    const suppressions = detectSuppressionChanges(parseUnifiedDiff(DIFF), ['p/default', 'rules/']);
    expect(suppressions).toEqual([
      { kind: 'nosemgrep', path: 'src/app.py', line: 3, detail: 'subprocess.call(x, shell=True)  # nosemgrep: rule.a' },
      { kind: 'semgrepignore', path: '.semgrepignore', detail: '.semgrepignore added' },
      { kind: 'rule-config', path: 'rules/custom.yml', detail: 'rule file deleted' },
    ]);
  });

  it('flags edits to the project rule locations even when the gate uses registry configs only', () => {
    const diff = 'diff --git a/.semgrep/rules.yml b/.semgrep/rules.yml\n--- a/.semgrep/rules.yml\n+++ b/.semgrep/rules.yml\n@@ -3 +3 @@\n-x\n+y\n';
    expect(detectSuppressionChanges(parseUnifiedDiff(diff), ['p/default'])).toEqual([
      { kind: 'rule-config', path: '.semgrep/rules.yml', detail: 'rule file modified' },
    ]);
  });

  it('ignores nosemgrep in prose files Semgrep never scans', () => {
    const diff = 'diff --git a/docs/x.md b/docs/x.md\n--- a/docs/x.md\n+++ b/docs/x.md\n@@ -1 +1 @@\n-a\n+Use `# nosemgrep: rule` with a reason.\n';
    expect(detectSuppressionChanges(parseUnifiedDiff(diff), ['p/default'])).toEqual([]);
  });

  it('reports nothing for a diff without suppressions', () => {
    expect(detectSuppressionChanges(parseUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'), ['p/default'])).toEqual([]);
  });
});

describe('decideSastGate: advisory unless blocking', () => {
  it('advisory with findings is not required and lists the findings', () => {
    const result = decideSastGate(input({ findings: [finding({ fix: 'shell=False' })] }));
    expect(result).toMatchObject({ name: 'sast', passed: false, required: false });
    expect(result.skipped).toBeUndefined();
    expect(result.output).toContain('src/app.py:3 [ERROR] python.lang.security.shell-true');
    expect(result.output).toContain('fix: shell=False');
  });

  it('blocking with findings is required and failed', () => {
    expect(decideSastGate(input({ mode: 'blocking', findings: [finding()] }))).toMatchObject({ passed: false, required: true });
  });

  it('blocking without findings passes', () => {
    expect(decideSastGate(input({ mode: 'blocking' }))).toMatchObject({ passed: true, required: true });
  });

  it('a scan that never completed is skipped, passed and not required, even in blocking mode', () => {
    for (const mode of ['advisory', 'blocking'] as const) {
      const result = decideSastGate(input({
        mode,
        repos: [{ repoKey: 'repo', head: 'abc', status: 'error', note: 'Semgrep exited 2 (scanner error or registry unreachable)' }],
      }));
      expect(result).toMatchObject({ passed: true, required: false, skipped: true });
      expect(result.error).toContain('Semgrep did not complete: Semgrep exited 2');
      expect(result.output).toContain('SKIPPED');
      expect(result.output).not.toContain('No findings');
    }
  });

  it('a partly scanned workspace with no findings is skipped and names the unscanned repo', () => {
    const result = decideSastGate(input({
      mode: 'blocking',
      repos: [
        { repoKey: 'fe', head: 'a', status: 'scanned' },
        { repoKey: 'api', head: 'b', status: 'error', note: 'Semgrep timed out after 300s and was killed' },
      ],
    }));
    expect(result).toMatchObject({ passed: true, required: false, skipped: true });
    expect(result.output).toContain('did not complete a scan of api');
  });

  it('a finding from a scanned repo still blocks when another repo could not be scanned', () => {
    const result = decideSastGate(input({
      mode: 'blocking',
      findings: [finding({ path: 'fe/src/app.py' })],
      repos: [
        { repoKey: 'fe', head: 'a', status: 'scanned' },
        { repoKey: 'api', head: 'b', status: 'error', note: 'Semgrep exited 2' },
      ],
    }));
    expect(result).toMatchObject({ passed: false, required: true });
    expect(result.skipped).toBeUndefined();
    expect(result.output).toContain('api: Semgrep exited 2');
  });

  it('asks the artifact to keep the output of a passing row only when it lists suppressions or notes', () => {
    expect(decideSastGate(input()).keepOutput).toBeUndefined();
    expect(decideSastGate(input({ suppressions: [{ kind: 'semgrepignore', path: '.semgrepignore', detail: '.semgrepignore added' }] })).keepOutput).toBe(true);
    expect(decideSastGate(input({ findings: [finding()] })).keepOutput).toBeUndefined();
  });

  it('no changed files is a pass, not a skip', () => {
    const result = decideSastGate(input({ mode: 'blocking', repos: [{ repoKey: 'repo', head: 'abc', status: 'no-targets' }] }));
    expect(result).toMatchObject({ passed: true, required: true });
    expect(result.skipped).toBeUndefined();
  });

  it('lists suppressions without failing the gate', () => {
    const result = decideSastGate(input({
      mode: 'blocking',
      suppressions: [{ kind: 'nosemgrep', path: 'a.py', line: 2, detail: 'x()  # nosemgrep' }],
    }));
    expect(result.passed).toBe(true);
    expect(result.output).toContain('nosemgrep a.py:2: x()  # nosemgrep');
  });
});

describe('sastFindingsForReview', () => {
  const record: SastLatestRecord = {
    version: 1,
    ranAt: '2026-11-16T00:00:00.000Z',
    mode: 'advisory',
    severity: 'ERROR',
    configs: ['p/default'],
    skipped: false,
    repos: [{ repoKey: 'fe', head: 'aaa', status: 'scanned' }, { repoKey: 'api', head: 'bbb', status: 'no-targets' }],
    findings: [finding({ path: 'fe/src/app.py' })],
    suppressions: [],
  };

  it('reuses the record when every reviewed head matches', () => {
    expect(sastFindingsForReview(record, new Map([['fe', 'aaa'], ['api', 'bbb']]))).toMatchObject({
      status: 'fresh',
      mode: 'advisory',
      findings: [{ path: 'fe/src/app.py' }],
    });
  });

  it('names the repos the gate could not scan', () => {
    const partial = { ...record, repos: [...record.repos.slice(0, 1), { repoKey: 'api', head: 'bbb', status: 'error' as const, note: 'exit 2' }] };
    expect(sastFindingsForReview(partial, new Map([['fe', 'aaa'], ['api', 'bbb']]))).toMatchObject({ status: 'fresh', unscanned: ['api'] });
  });

  it('is stale when any head moved, and lists nothing', () => {
    expect(sastFindingsForReview(record, new Map([['fe', 'aaa'], ['api', 'ccc']]))).toEqual({
      status: 'stale', mode: 'advisory', findings: [], suppressions: [],
    });
  });

  it('is absent without a record', () => {
    expect(sastFindingsForReview(null, new Map([['fe', 'aaa']]))).toEqual({ status: 'absent', findings: [], suppressions: [] });
  });
});
