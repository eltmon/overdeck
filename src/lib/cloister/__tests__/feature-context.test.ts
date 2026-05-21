/**
 * Tests for readFeatureContext / writeStoryFeatureContext.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFeatureContext, writeStoryFeatureContext } from '../work-agent-prompt.js';
import { PAN_DIRNAME, PAN_CONTEXT_FILENAME } from '../../pan-dir/index.js';

// Mock tracker factory
const mockGetIssue = vi.hoisted(() => vi.fn());

vi.mock('../../tracker/factory.js', () => ({
  createTrackerFromConfig: vi.fn(() => ({
    getIssue: mockGetIssue,
  })),
}));

function mockTrackerResponse(storyRef: string, parentRef: string, parentTitle?: string) {
  // Tracker.getIssue is Effect-returning post-PAN-1249.
  mockGetIssue.mockImplementation((id: string) => {
    if (id.toUpperCase() === storyRef.toUpperCase()) return Effect.succeed({ parentRef });
    if (id.toUpperCase() === parentRef.toUpperCase()) return Effect.succeed({ title: parentTitle || parentRef });
    return Effect.succeed({});
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
    workspacePath = join(tmpDir, 'workspaces', 'feature-us-123');
    mkdirSync(join(workspacePath, PAN_DIRNAME), { recursive: true });
    mockGetIssue.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns local .pan/context.md when present', async () => {
    const content = '# Feature Context: US-123\nLocal context';
    writeFileSync(join(workspacePath, PAN_DIRNAME, PAN_CONTEXT_FILENAME), content, 'utf-8');
    const result = await readFeatureContext(workspacePath, 'US-123');
    expect(result).toBe(content);
  });

  it('falls back to deterministic parent workspace lookup via tracker', async () => {
    const parentWorkspace = join(tmpDir, 'workspaces', 'feature-f-456');
    mkdirSync(join(parentWorkspace, PAN_DIRNAME), { recursive: true });
    const parentContent = '# Feature Context: F-456\nParent context';
    writeFileSync(join(parentWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), parentContent, 'utf-8');

    mockTrackerResponse('US-123', 'F-456');

    const result = await readFeatureContext(workspacePath, 'US-123');
    expect(result).toBe(parentContent);
    expect(mockGetIssue).toHaveBeenCalledWith('US-123');
  });

  it('returns null when no local file and no parent ref', async () => {
    mockGetIssue.mockReturnValue(Effect.succeed({ parentRef: undefined }));
    const result = await readFeatureContext(workspacePath, 'US-123');
    expect(result).toBeNull();
  });
});

describe('writeStoryFeatureContext', () => {
  let tmpDir: string;
  let storyWorkspace: string;
  let parentWorkspace: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fc-test-'));
    storyWorkspace = join(tmpDir, 'workspaces', 'feature-us-123');
    parentWorkspace = join(tmpDir, 'workspaces', 'feature-f-456');
    mkdirSync(join(storyWorkspace, PAN_DIRNAME), { recursive: true });
    mkdirSync(join(parentWorkspace, PAN_DIRNAME), { recursive: true });
    mockGetIssue.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no-ops when local .pan/context.md already exists', async () => {
    writeFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'existing', 'utf-8');
    mockTrackerResponse('US-123', 'F-456');

    await writeStoryFeatureContext(storyWorkspace, 'US-123');
    expect(mockGetIssue).not.toHaveBeenCalled();
  });

  it('synthesizes context from parent vBRIEF spec on main', async () => {
    mockTrackerResponse('US-123', 'F-456', 'The Big Feature');

    // Write the parent spec to the main-side .pan/specs/ directory
    const planDoc = {
      vBRIEFInfo: { version: '0.5', created: '2024-01-01T00:00:00Z' },
      plan: {
        id: 'F-456',
        title: 'Feature Plan',
        status: 'active',
        items: [
          { id: 'item-1', title: 'US-123: Build widget', status: 'pending', narrative: { Action: 'Build it' }, subItems: [] },
          { id: 'item-2', title: 'US-789: Other thing', status: 'pending' },
        ],
        edges: [{ from: 'item-1', to: 'item-2', type: 'blocks' }],
        narratives: { Problem: 'We need widgets', Proposal: 'Build them' },
      },
      status: 'active',
    };
    const specsDir = join(tmpDir, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(
      join(specsDir, '2024-01-01-F-456-feature-plan.vbrief.json'),
      JSON.stringify(planDoc, null, 2),
      'utf-8',
    );

    await writeStoryFeatureContext(storyWorkspace, 'US-123');

    const written = readFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(written).toContain('Feature Context for US-123');
    expect(written).toContain('Parent Feature:** The Big Feature (F-456)');
    expect(written).toContain('Problem');
    expect(written).toContain('We need widgets');
    expect(written).toContain('Cross-Story Dependencies');
    expect(written).toContain('item-1** blocks **item-2');
    expect(written).toContain('Build widget');
    expect(written).toContain('Action: Build it');
    expect(written).not.toContain('Other thing');
  });

  it('falls back to parent .pan/context.md when no spec exists on main', async () => {
    mockTrackerResponse('US-123', 'F-456', 'The Big Feature');
    writeFileSync(join(parentWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), '# Parent Context\nFallback', 'utf-8');

    await writeStoryFeatureContext(storyWorkspace, 'US-123');

    const written = readFileSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME), 'utf-8');
    expect(written).toBe('# Parent Context\nFallback');
  });

  it('no-ops when issue has no parentRef', async () => {
    mockGetIssue.mockReturnValue(Effect.succeed({ parentRef: undefined }));
    await writeStoryFeatureContext(storyWorkspace, 'US-123');
    expect(existsSync(join(storyWorkspace, PAN_DIRNAME, PAN_CONTEXT_FILENAME))).toBe(false);
  });
});
