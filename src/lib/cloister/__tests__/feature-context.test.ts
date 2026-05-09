/**
 * Tests for readFeatureContext / writeStoryFeatureContext.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFeatureContext, writeStoryFeatureContext } from '../work-agent-prompt.js';
import { PAN_DIRNAME, PAN_CONTEXT_FILENAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';

// Mock tracker factory
const mockGetIssue = vi.hoisted(() => vi.fn());

vi.mock('../../tracker/factory.js', () => ({
  createTrackerFromConfig: vi.fn(() => ({
    getIssue: mockGetIssue,
  })),
}));

function mockTrackerResponse(storyRef: string, parentRef: string, parentTitle?: string) {
  mockGetIssue.mockImplementation((id: string) => {
    if (id.toUpperCase() === storyRef.toUpperCase()) return Promise.resolve({ parentRef });
    if (id.toUpperCase() === parentRef.toUpperCase()) return Promise.resolve({ title: parentTitle || parentRef });
    return Promise.resolve({});
  });
}

vi.mock('../../config.js', () => ({
  loadConfig: vi.fn(() => ({
    trackers: {
      primary: 'rally',
      rally: { apiKeyEnv: 'RALLY_API_KEY' },
    },
  })),
}));

describe('readFeatureContext', () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fc-test-'));
    workspacePath = join(tmpDir, 'workspaces', 'feature-us123');
    mkdirSync(join(workspacePath, PAN_DIRNAME), { recursive: true });
    mockGetIssue.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns local .pan/context.md when present', async () => {
    const content = '# Feature Context: US123\nLocal context';
    writeFileSync(join(workspacePath, PAN_DIRNAME, PAN_CONTEXT_FILENAME), content, 'utf-8');
    const result = await readFeatureContext(workspacePath, 'US123');
    expect(result).toBe(content);
  });

  it('falls back to deterministic parent workspace lookup via tracker', async () => {
    const parentWorkspace = join(tmpDir, 'workspaces', 'feature-f456');
    mkdirSync(join(parentWorkspace, PAN_DIRNAME), { recursive: true });
    const parentContent = '# Feature Context: F456\nParent context';
    writeFileSync(join(parentWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), parentContent, 'utf-8');

    mockTrackerResponse('US123', 'F456');

    const result = await readFeatureContext(workspacePath, 'US123');
    expect(result).toBe(parentContent);
    expect(mockGetIssue).toHaveBeenCalledWith('US123');
  });

  it('returns null when no local file and no parent ref', async () => {
    mockGetIssue.mockResolvedValue({ parentRef: undefined });
    const result = await readFeatureContext(workspacePath, 'US123');
    expect(result).toBeNull();
  });
});

describe('writeStoryFeatureContext', () => {
  let tmpDir: string;
  let storyWorkspace: string;
  let parentWorkspace: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fc-test-'));
    storyWorkspace = join(tmpDir, 'workspaces', 'feature-us123');
    parentWorkspace = join(tmpDir, 'workspaces', 'feature-f456');
    mkdirSync(join(storyWorkspace, PAN_DIRNAME), { recursive: true });
    mkdirSync(join(parentWorkspace, PAN_DIRNAME), { recursive: true });
    mockGetIssue.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no-ops when local .pan/context.md already exists', async () => {
    writeFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'existing', 'utf-8');
    mockTrackerResponse('US123', 'F456');

    await writeStoryFeatureContext(storyWorkspace, 'US123');
    expect(mockGetIssue).not.toHaveBeenCalled();
  });

  it('synthesizes context from parent .pan/spec.vbrief.json', async () => {
    mockTrackerResponse('US123', 'F456', 'The Big Feature');

    const planDoc = {
      vBRIEFInfo: { version: '0.5', created: '2024-01-01T00:00:00Z' },
      plan: {
        id: 'plan-1',
        title: 'Feature Plan',
        status: 'approved',
        items: [
          { id: 'item-1', title: 'US123: Build widget', status: 'pending', narrative: { Action: 'Build it' }, subItems: [] },
          { id: 'item-2', title: 'US789: Other thing', status: 'pending' },
        ],
        edges: [{ from: 'item-1', to: 'item-2', type: 'blocks' }],
        narratives: { Problem: 'We need widgets', Proposal: 'Build them' },
      },
    };
    writeFileSync(join(parentWorkspace, PAN_DIRNAME, PAN_SPEC_FILENAME), JSON.stringify(planDoc, null, 2), 'utf-8');

    await writeStoryFeatureContext(storyWorkspace, 'US123');

    const written = readFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(written).toContain('Feature Context for US123');
    expect(written).toContain('Parent Feature:** The Big Feature (F456)');
    expect(written).toContain('Problem');
    expect(written).toContain('We need widgets');
    expect(written).toContain('Cross-Story Dependencies');
    expect(written).toContain('item-1** blocks **item-2');
    expect(written).toContain('Build widget');
    expect(written).toContain('Action: Build it');
    expect(written).not.toContain('Other thing');
  });

  it('falls back to parent .pan/context.md when .pan/spec.vbrief.json is absent', async () => {
    mockTrackerResponse('US123', 'F456', 'The Big Feature');
    writeFileSync(join(parentWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), '# Parent Context\nFallback', 'utf-8');

    await writeStoryFeatureContext(storyWorkspace, 'US123');

    const written = readFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(written).toBe('# Parent Context\nFallback');
  });

  it('no-ops when issue has no parentRef', async () => {
    mockGetIssue.mockResolvedValue({ parentRef: undefined });
    await writeStoryFeatureContext(storyWorkspace, 'US123');
    expect(existsSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME))).toBe(false);
  });
});
