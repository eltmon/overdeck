/**
 * Tests for flywheel-report (PAN-709)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { formatRunSection, appendFlywheelReport } from '../flywheel-report.js';
import type { FlywheelRunStats } from '../flywheel-report.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeStats(overrides: Partial<FlywheelRunStats> = {}): FlywheelRunStats {
  return {
    runNumber: 1,
    timestamp: '2026-04-18T12:00:00Z',
    trigger: 'daemon-event',
    issuesMergedThisRun: [],
    skillChangesFiled: [],
    substrateInlineFixes: [],
    topFrictionPatterns: [],
    watchlist: [],
    retroStats: { total: 3, surprise: 2, noop: 1 },
    ...overrides,
  };
}

// ============================================================================
// Suite: formatRunSection
// ============================================================================

describe('formatRunSection', () => {
  it('includes run number, date, and trigger in heading', () => {
    const section = formatRunSection(makeStats({ runNumber: 5, timestamp: '2026-04-18T09:00:00Z', trigger: 'daemon-scheduled' }));
    expect(section).toContain('## Run 5 — 2026-04-18 — _daemon-scheduled_');
  });

  it('includes retro stats', () => {
    const section = formatRunSection(makeStats({ retroStats: { total: 10, surprise: 7, noop: 3 } }));
    expect(section).toContain('Retros processed: 10 (7 surprise, 3 no-op)');
  });

  it('shows merged issues when present', () => {
    const section = formatRunSection(makeStats({ issuesMergedThisRun: ['PAN-100', 'PAN-101'] }));
    expect(section).toContain('Issues merged this run: 2 (PAN-100, PAN-101)');
  });

  it('omits merged issues line when empty', () => {
    const section = formatRunSection(makeStats({ issuesMergedThisRun: [] }));
    expect(section).not.toContain('Issues merged this run');
  });

  it('shows skill-change issues section when filed', () => {
    const section = formatRunSection(makeStats({
      skillChangesFiled: [{ issueId: 'PAN-500', title: 'update planning-agent', signals: 4 }],
    }));
    expect(section).toContain('### Skill-change issues filed');
    expect(section).toContain('[PAN-500]');
    expect(section).toContain('update planning-agent');
    expect(section).toContain('signals: 4');
  });

  it('shows watchlist section when below-threshold items exist', () => {
    const section = formatRunSection(makeStats({
      watchlist: [{ description: 'tmux paste unreliable', signals: 2 }],
    }));
    expect(section).toContain('### Watchlist (below 3-signal threshold)');
    expect(section).toContain('tmux paste unreliable — 2 signals');
  });

  it('shows singular "signal" for count of 1', () => {
    const section = formatRunSection(makeStats({
      watchlist: [{ description: 'edge case', signals: 1 }],
    }));
    expect(section).toContain('1 signal');
    expect(section).not.toContain('1 signals');
  });

  it('shows top friction patterns', () => {
    const section = formatRunSection(makeStats({
      topFrictionPatterns: [{ pattern: 'sync FS in routes', issueCount: 3, note: 'PAN-446' }],
    }));
    expect(section).toContain('### Top friction patterns this run');
    expect(section).toContain('sync FS in routes');
    expect(section).toContain('3 issues');
    expect(section).toContain('PAN-446');
  });

  it('shows singular "issue" for count of 1', () => {
    const section = formatRunSection(makeStats({
      topFrictionPatterns: [{ pattern: 'pattern', issueCount: 1 }],
    }));
    expect(section).toContain('1 issue affected');
    expect(section).not.toContain('1 issues');
  });

  it('shows wins section when wins present', () => {
    const section = formatRunSection(makeStats({ wins: ['Zero regressions', 'CI green'] }));
    expect(section).toContain('### Wins');
    expect(section).toContain('Zero regressions');
  });

  it('ends with horizontal rule', () => {
    const section = formatRunSection(makeStats());
    expect(section.trimEnd()).toMatch(/---$/);
  });
});

// ============================================================================
// Suite: appendFlywheelReport
// ============================================================================

describe('appendFlywheelReport', () => {
  let reportDir: string;
  let reportPath: string;

  beforeEach(async () => {
    reportDir = join(tmpdir(), `pan-report-test-${randomUUID()}`);
    await fs.mkdir(reportDir, { recursive: true });
    reportPath = join(reportDir, 'FLYWHEEL-REPORT.md');
  });

  afterEach(async () => {
    await fs.rm(reportDir, { recursive: true, force: true });
  });

  it('creates file with header on first call', async () => {
    await appendFlywheelReport(makeStats({ runNumber: 1 }), reportPath);
    const content = await fs.readFile(reportPath, 'utf-8');
    expect(content).toContain('# Flywheel Report');
    expect(content).toContain('## Run 1');
  });

  it('returns the path written to', async () => {
    const result = await appendFlywheelReport(makeStats(), reportPath);
    expect(result).toBe(reportPath);
  });

  it('inserts new runs before existing ones (newest first)', async () => {
    await appendFlywheelReport(makeStats({ runNumber: 1 }), reportPath);
    await appendFlywheelReport(makeStats({ runNumber: 2 }), reportPath);

    const content = await fs.readFile(reportPath, 'utf-8');
    const run1Idx = content.indexOf('## Run 1');
    const run2Idx = content.indexOf('## Run 2');
    expect(run2Idx).toBeLessThan(run1Idx);
  });

  it('does not duplicate the header on subsequent calls', async () => {
    await appendFlywheelReport(makeStats({ runNumber: 1 }), reportPath);
    await appendFlywheelReport(makeStats({ runNumber: 2 }), reportPath);

    const content = await fs.readFile(reportPath, 'utf-8');
    const headerCount = (content.match(/# Flywheel Report/g) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it('preserves existing content (append-only — no rewrites)', async () => {
    await appendFlywheelReport(makeStats({ runNumber: 1, wins: ['First win'] }), reportPath);
    await appendFlywheelReport(makeStats({ runNumber: 2 }), reportPath);

    const content = await fs.readFile(reportPath, 'utf-8');
    expect(content).toContain('First win');
    expect(content).toContain('## Run 1');
    expect(content).toContain('## Run 2');
  });

  it('creates parent directories if missing', async () => {
    const nestedPath = join(reportDir, 'nested', 'deep', 'FLYWHEEL-REPORT.md');
    await appendFlywheelReport(makeStats(), nestedPath);
    await expect(fs.access(nestedPath)).resolves.toBeUndefined();
  });
});
