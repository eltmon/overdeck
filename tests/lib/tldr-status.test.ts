import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock chalk to return plain strings for testability
vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

// Prevent @effect/platform-node from loading NodeRedis.js (which requires ioredis, not installed)
vi.mock('@effect/platform-node', async () => {
  const { Layer } = await import('effect');
  return { NodeServices: { layer: Layer.empty } };
});

// Declare the mock function at module scope so vi.mock factory can close over it
const mockGetStatus = vi.fn(() => Effect.succeed({ running: false, healthy: false, workspacePath: '', venvPath: '' }));

vi.mock('../../src/lib/tldr-daemon.js', () => ({
  getTldrDaemonService: () => ({ getStatus: mockGetStatus }),
}));

// Import the module once at the top level (after mocks are in place)
const { tldrIndexStatusCommand } = await import('../../src/cli/commands/status.js');

describe('tldrIndexStatusCommand', () => {
  let tempDir: string;
  const consoleLogs: string[] = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-tldr-status-test-'));
    consoleLogs.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });
    mockGetStatus.mockReturnValue(Effect.succeed({ running: false, healthy: false, workspacePath: tempDir, venvPath: '' }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shows no indexes found when no .venv exists', async () => {
    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('No TLDR indexes found');
    expect(output).toContain('pan admin tldr start');
  });

  it('shows main index stats when .venv and .tldr exist', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, '.tldr', 'cache'), { recursive: true });
    const edges = [
      { from_file: 'a.ts', to_file: 'b.ts' },
      { from_file: 'b.ts', to_file: 'c.ts' },
    ];
    writeFileSync(join(tempDir, '.tldr', 'cache', 'call_graph.json'), JSON.stringify({ edges }));
    writeFileSync(join(tempDir, '.tldr', 'languages.json'), JSON.stringify({
      timestamp: Math.floor((Date.now() - 5 * 60 * 1000) / 1000),
    }));
    mockGetStatus.mockReturnValue(Effect.succeed({ running: true, healthy: true, workspacePath: tempDir, venvPath: '' }));

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('TLDR Index Health');
    expect(output).toContain('Files: 3');
    expect(output).toContain('Edges: 2');
    expect(output).toContain('running ✓');
  });

  it('shows "not indexed" when .venv exists but .tldr does not', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('not indexed');
    expect(output).toContain('Files: N/A');
  });

  it('reports health as fresh when daemon running and index <1h old', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, '.tldr', 'cache'), { recursive: true });
    writeFileSync(join(tempDir, '.tldr', 'cache', 'call_graph.json'), JSON.stringify({
      edges: [{ from_file: 'a.ts', to_file: 'b.ts' }],
    }));
    writeFileSync(join(tempDir, '.tldr', 'languages.json'), JSON.stringify({
      timestamp: Math.floor((Date.now() - 10 * 60 * 1000) / 1000),
    }));
    mockGetStatus.mockReturnValue(Effect.succeed({ running: true, healthy: true, workspacePath: tempDir, venvPath: '' }));

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('✓ All indexes fresh');
  });

  it('reports health as stale when index is >1h old', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, '.tldr', 'cache'), { recursive: true });
    writeFileSync(join(tempDir, '.tldr', 'cache', 'call_graph.json'), JSON.stringify({
      edges: [{ from_file: 'a.ts', to_file: 'b.ts' }],
    }));
    writeFileSync(join(tempDir, '.tldr', 'languages.json'), JSON.stringify({
      timestamp: Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000),
    }));
    mockGetStatus.mockReturnValue(Effect.succeed({ running: true, healthy: true, workspacePath: tempDir, venvPath: '' }));

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('⚠ Some indexes stale');
  });

  it('reports health as not configured when daemon is stopped', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, '.tldr', 'cache'), { recursive: true });
    writeFileSync(join(tempDir, '.tldr', 'cache', 'call_graph.json'), JSON.stringify({
      edges: [{ from_file: 'a.ts', to_file: 'b.ts' }],
    }));
    writeFileSync(join(tempDir, '.tldr', 'languages.json'), JSON.stringify({
      timestamp: Math.floor((Date.now() - 5 * 60 * 1000) / 1000),
    }));
    // mockGetStatus already returns running: false from beforeEach

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('✗ TLDR not fully configured');
  });

  it('lists workspace entries under Workspaces section', async () => {
    mkdirSync(join(tempDir, '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, 'workspaces', 'feature-test', '.venv', 'bin'), { recursive: true });
    mkdirSync(join(tempDir, 'workspaces', 'feature-test', '.tldr', 'cache'), { recursive: true });
    writeFileSync(
      join(tempDir, 'workspaces', 'feature-test', '.tldr', 'cache', 'call_graph.json'),
      JSON.stringify({ edges: [{ from_file: 'x.ts', to_file: 'y.ts' }] })
    );
    writeFileSync(
      join(tempDir, 'workspaces', 'feature-test', '.tldr', 'languages.json'),
      JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) })
    );
    mockGetStatus.mockReturnValue(Effect.succeed({ running: true, healthy: true, workspacePath: tempDir, venvPath: '' }));

    await tldrIndexStatusCommand(tempDir);
    const output = consoleLogs.join('\n');
    expect(output).toContain('Workspaces');
    expect(output).toContain('feature-test');
  });
});
