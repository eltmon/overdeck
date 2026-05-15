import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { VBriefDocument } from '../../../src/lib/vbrief/types.js';
import type { ContinueState } from '../../../src/lib/vbrief/continue-state.js';

vi.mock('../../../src/lib/beads-query.js', () => ({
  queryBeadsForIssue: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn(() => ({ trackers: undefined })),
  getDashboardApiUrl: vi.fn(() => 'http://localhost:3011'),
}));

import { buildWorkAgentPrompt } from '../../../src/lib/cloister/work-agent-prompt.js';

describe('PAN-977 work-agent active slice prompt', () => {
  it('injects persisted synthesis context from continue state without full-plan measurement text', async () => {
    const projectRoot = mkdtempSync(`${tmpdir()}/work-agent-pan977-`);
    const workspace = join(projectRoot, 'workspaces', 'feature-pan-977');
    try {
      mkdirSync(join(workspace, '.pan', 'continues'), { recursive: true });
      mkdirSync(join(workspace, '.beads'), { recursive: true });
      const doc: VBriefDocument = {
        vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z', description: 'Prompt slice objective' },
        plan: {
          id: 'PAN-977',
          title: 'PAN-977 Active Slice Plan',
          status: 'running',
          sequence: 9,
          narratives: { Constraint: 'Use bounded context only' },
          tags: ['PAN-977'],
          items: [
            { id: 'parent-a', title: 'Parent A', status: 'completed' },
            { id: 'target-b', title: 'Target B', status: 'pending', subItems: [{ id: 'target-b.ac1', title: 'Shows synthesis', status: 'pending' }] },
          ],
          edges: [{ from: 'parent-a', to: 'target-b', type: 'blocks' }],
        },
      };
      const specsDir = join(projectRoot, '.pan', 'specs');
      mkdirSync(specsDir, { recursive: true });
      writeFileSync(join(specsDir, '2026-01-01-PAN-977-test.vbrief.json'), JSON.stringify(doc, null, 2), 'utf-8');
      const cont: ContinueState = {
        version: '1',
        issueId: 'PAN-977',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        gitState: { branch: 'feature/pan-977', baseBranch: 'main', headSha: 'abc123', isDirty: false },
        decisions: [],
        hazards: [],
        resumePoint: null,
        beadsMapping: {},
        sessionHistory: [],
        swarmRuntime: {
          model: 'test-model',
          slots: [],
          synthesisOutputs: {
            'target-b': {
              targetItemId: 'target-b',
              writtenAt: '2026-01-01T00:00:00Z',
              contextUpdate: 'Persisted convergence synthesis appears here',
            },
          },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      };
      writeFileSync(join(workspace, '.pan', 'continues', 'pan-977.vbrief.json'), JSON.stringify(cont, null, 2), 'utf-8');

      const prompt = await buildWorkAgentPrompt({ issueId: 'PAN-977', env: 'LOCAL', workspacePath: workspace, projectRoot });

      expect(prompt).toContain('## Active vBRIEF Slice (Canonical Task Graph)');
      expect(prompt).toContain('PAN-977 Active Slice Plan');
      expect(prompt).toContain('Persisted convergence synthesis appears here');
      expect(prompt).not.toContain('Prompt-size check: active slice');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
