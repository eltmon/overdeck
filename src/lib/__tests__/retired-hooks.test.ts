import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { retireTldrHooks } from '../retired-hooks.js';
import { listCandidateCheckouts } from '../legacy-tldr-cleanup.js';
import { pruneRetiredOverdeckHooks } from '../retired-hooks-prune.js';

// PAN-4429: TLDR's hooks are unregistered from settings.json before their
// scripts are deleted from ~/.overdeck/bin/.

describe('pruneRetiredOverdeckHooks', () => {
  const binDir = '/home/user/.overdeck/bin';

  it('removes both command forms and keeps unrelated hooks in the same group', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read',
            hooks: [
              { type: 'command', command: '/home/user/.overdeck/bin/tldr-read-enforcer' },
              { type: 'command', command: '/custom/read-hook' },
            ],
          },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '$HOME/.overdeck/bin/tldr-post-edit' }] },
          { matcher: '.*', hooks: [{ type: 'command', command: '/home/user/.overdeck/bin/heartbeat-hook' }] },
        ],
      },
    };

    const removed = pruneRetiredOverdeckHooks(settings, binDir);

    expect(removed.sort()).toEqual(['PostToolUse:tldr-post-edit', 'PreToolUse:tldr-read-enforcer']);
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: 'Read', hooks: [{ type: 'command', command: '/custom/read-hook' }] },
    ]);
    expect(settings.hooks.PostToolUse).toEqual([
      { matcher: '.*', hooks: [{ type: 'command', command: '/home/user/.overdeck/bin/heartbeat-hook' }] },
    ]);
  });

  it('returns nothing when no retired hook is registered', () => {
    const settings = {
      hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: '/home/user/.overdeck/bin/stop-hook' }] }] },
    };
    const before = JSON.stringify(settings);
    expect(pruneRetiredOverdeckHooks(settings, binDir)).toEqual([]);
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe('retireTldrHooks', () => {
  let root: string;
  let settingsPath: string;
  let mcpPath: string;
  let binDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-retired-hooks-'));
    settingsPath = join(root, 'claude', 'settings.json');
    mcpPath = join(root, 'claude', 'mcp.json');
    binDir = join(root, 'bin');
    mkdirSync(join(root, 'claude'), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'tldr-read-enforcer'), '#!/bin/sh\n');
    writeFileSync(join(binDir, 'tldr-post-edit'), '#!/bin/sh\n');
    writeFileSync(join(binDir, 'stop-hook'), '#!/bin/sh\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSettings(): void {
    writeFileSync(settingsPath, JSON.stringify({
      statusLine: { type: 'command', command: 'my-statusline' },
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: join(binDir, 'tldr-read-enforcer') }] }],
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: join(binDir, 'tldr-post-edit') }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: join(binDir, 'stop-hook') }] }],
      },
    }, null, 2));
  }

  it('unregisters, then deletes the bin files, and a second run is a no-op', async () => {
    writeSettings();

    const first = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [] });

    expect(first.unregistered.sort()).toEqual(['PostToolUse:tldr-post-edit', 'PreToolUse:tldr-read-enforcer']);
    expect(first.deletedBins.sort()).toEqual([join(binDir, 'tldr-post-edit'), join(binDir, 'tldr-read-enforcer')]);
    expect(existsSync(join(binDir, 'stop-hook'))).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.statusLine).toEqual({ type: 'command', command: 'my-statusline' });
    expect(settings.hooks.PreToolUse).toEqual([]);
    expect(settings.hooks.Stop).toHaveLength(1);

    const bytes = readFileSync(settingsPath, 'utf-8');
    const second = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [] });
    expect(second.unregistered).toEqual([]);
    expect(second.deletedBins).toEqual([]);
    expect(readFileSync(settingsPath, 'utf-8')).toBe(bytes);
  });

  it('never rewrites an unparseable settings.json but still deletes the bin files', async () => {
    writeFileSync(settingsPath, '{ not json');

    const result = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [] });

    expect(result.warning).toMatch(/not valid JSON/);
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{ not json');
    expect(existsSync(join(binDir, 'tldr-read-enforcer'))).toBe(false);
    expect(existsSync(join(binDir, 'tldr-post-edit'))).toBe(false);
  });

  it('removes the tldr-mcp server entry and keeps other servers', async () => {
    writeFileSync(mcpPath, JSON.stringify({
      mcpServers: {
        tldr: { command: '.venv/bin/tldr-mcp', args: ['--project', '.'] },
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    }));

    const result = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [] });

    expect(result.mcpRemoved).toBe(true);
    expect(JSON.parse(readFileSync(mcpPath, 'utf-8')).mcpServers).toEqual({
      playwright: { command: 'npx', args: ['@playwright/mcp'] },
    });
  });

  it('keeps a tldr server entry that is not the Overdeck-written tldr-mcp', async () => {
    const config = { mcpServers: { tldr: { command: '/opt/other/tldr-server' } } };
    writeFileSync(mcpPath, JSON.stringify(config));

    const result = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [] });

    expect(result.mcpRemoved).toBe(false);
    expect(JSON.parse(readFileSync(mcpPath, 'utf-8'))).toEqual(config);
  });

  it('sweeps checkout-local settings and mcp copies, skipping unparseable files', async () => {
    const checkout = join(root, 'project', 'workspaces', 'feature-x');
    const claudeDir = join(checkout, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: '/home/other/.overdeck/bin/tldr-read-enforcer' }] }] },
    }));
    writeFileSync(join(claudeDir, 'settings.local.json'), '{ broken');
    writeFileSync(join(claudeDir, 'mcp.json'), JSON.stringify({ mcpServers: { tldr: { command: '.venv/bin/tldr-mcp' } } }));

    const result = await retireTldrHooks({ settingsPath, binDir, mcpPath, listCheckouts: () => [checkout] });

    expect(result.checkoutFilesUpdated.sort()).toEqual([join(claudeDir, 'mcp.json'), join(claudeDir, 'settings.json')]);
    expect(JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8')).hooks.PreToolUse).toEqual([]);
    expect(readFileSync(join(claudeDir, 'settings.local.json'), 'utf-8')).toBe('{ broken');
    expect(JSON.parse(readFileSync(join(claudeDir, 'mcp.json'), 'utf-8')).mcpServers).toEqual({});
  });

  it('does nothing under the test runner without an explicit settingsPath', async () => {
    const result = await retireTldrHooks({ binDir, listCheckouts: () => [] });
    expect(result).toEqual({ unregistered: [], deletedBins: [], mcpRemoved: false, checkoutFilesUpdated: [] });
    expect(existsSync(join(binDir, 'tldr-read-enforcer'))).toBe(true);
  });
});

describe('listCandidateCheckouts', () => {
  it('lists each project root and the directories under its workspaces/', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-retired-checkouts-'));
    try {
      mkdirSync(join(root, 'workspaces', 'feature-a'), { recursive: true });
      writeFileSync(join(root, 'workspaces', 'stray-file'), '');
      const projects = [
        { key: 'p', config: { name: 'p', path: root } },
        { key: 'gone', config: { name: 'gone', path: join(root, 'missing') } },
      ] as unknown as Parameters<typeof listCandidateCheckouts>[0];

      expect(listCandidateCheckouts(projects)).toEqual([root, join(root, 'workspaces', 'feature-a')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
