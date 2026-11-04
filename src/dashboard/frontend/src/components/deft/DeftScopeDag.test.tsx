/**
 * PAN-4849 WI-12: Deft scopes become DAG nodes with folder-derived statuses
 * and swarm dependency edges.
 */
import type { DeftScope } from '@overdeck/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

vi.mock('./queries', () => ({ useDeftIssueState: () => ({ data: golden }) }));

import { DeftScopeDag, deftScopesToDag } from './DeftScopeDag';

const SCOPES = golden.scopes as DeftScope[];

afterEach(cleanup);

describe('deftScopesToDag', () => {
  it('maps folders to statuses, adds the dependency edge and the conflict group', () => {
    const { nodes, edges } = deftScopesToDag(SCOPES);
    expect(nodes).toEqual([
      { id: 'scope-idea', title: 'Idea scope', status: 'waiting' },
      { id: 'scope-base', title: 'Base scope', status: 'waiting' },
      { id: 'scope-ui', title: 'UI scope [ui]', status: 'in-progress' },
      { id: 'scope-done', title: 'Done scope', status: 'done' },
      { id: 'scope-drop', title: 'Dropped scope', status: 'blocked' },
    ]);
    expect(edges).toEqual([{ from: 'scope-base', to: 'scope-ui' }]);
  });

  it('drops a dependency on an unknown scope', () => {
    const scopes = SCOPES.map((scope) =>
      scope.swarm ? { ...scope, swarm: { ...scope.swarm, dependsOn: ['scope-base', 'scope-gone'] } } : scope);
    expect(deftScopesToDag(scopes).edges).toEqual([{ from: 'scope-base', to: 'scope-ui' }]);
  });
});

describe('DeftScopeDag', () => {
  it('renders the graph and each file scope', () => {
    render(<DeftScopeDag issueId="PAN-1" />);
    expect(screen.getByText('Deft scopes')).toBeInTheDocument();
    expect(screen.getByText('scope-ui: src/a.ts, docs/')).toBeInTheDocument();
  });
});
