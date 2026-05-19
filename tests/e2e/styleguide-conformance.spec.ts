import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

async function readSource(path: string) {
  return readFile(join(root, path), 'utf8');
}

describe('styleguide conformance', () => {
  it('asserts shared primitive signatures across canonical surfaces', async () => {
    const surfaces = [
      {
        route: '/pipeline',
        file: 'src/dashboard/frontend/src/components/Pipeline/PipelineView.tsx',
        primaryPrimitive: 'IssueRow',
        primaryComponent: 'issue-row',
      },
      {
        route: '/board',
        file: 'src/dashboard/frontend/src/components/KanbanBoard.tsx',
        primaryPrimitive: 'IssueCardPrimitive',
        primaryComponent: 'issue-card',
      },
      {
        route: '/command-deck',
        file: 'src/dashboard/frontend/src/components/CommandDeck/ProjectOverview.tsx',
        primaryPrimitive: 'IssueRow',
        primaryComponent: 'issue-row',
      },
      {
        route: '/agents',
        file: 'src/dashboard/frontend/src/components/Agents/FleetAgentsView.tsx',
        primaryPrimitive: 'AgentCard',
        primaryComponent: 'agent-card',
      },
    ] as const;

    const primitiveSources = {
      'issue-row': await readSource('src/dashboard/frontend/src/components/primitives/IssueRow.tsx'),
      'issue-card': await readSource('src/dashboard/frontend/src/components/primitives/IssueCard.tsx'),
      'agent-card': await readSource('src/dashboard/frontend/src/components/primitives/AgentCard.tsx'),
      'verb-badge': await readSource('src/dashboard/frontend/src/components/primitives/VerbBadge.tsx'),
    };

    expect(primitiveSources['verb-badge']).toContain('data-component="verb-badge"');

    for (const surface of surfaces) {
      const source = await readSource(surface.file);
      expect(source, `${surface.route} uses ${surface.primaryPrimitive}`).toContain(surface.primaryPrimitive);
      expect(source, `${surface.route} renders VerbBadge`).toContain('VerbBadge');
      expect(primitiveSources[surface.primaryComponent]).toContain(`data-component="${surface.primaryComponent}"`);
    }
  });

  it.skip('skips /god-view because it is outside the PAN-1148 styleguide surface set', () => {
    expect('/god-view').toBe('/god-view');
  });
});
