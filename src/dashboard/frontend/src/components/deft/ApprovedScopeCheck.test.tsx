/**
 * PAN-4849 WI-16: changed files checked against Deft's approved scopes.
 */
import type { DeftApprovedScope } from '@overdeck/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./queries', () => ({ useDeftIssueState: () => ({ data: state.value }) }));

import { ApprovedScopeCheck, outOfScopeFiles } from './ApprovedScopeCheck';

const APPROVED = golden.approvedScopes as DeftApprovedScope[];

afterEach(cleanup);

describe('outOfScopeFiles', () => {
  it('accepts exact entries, directory entries and the state archive', () => {
    expect(outOfScopeFiles(['src/a.ts', 'docs/x.md', 'src/b.ts', '.pan/deft/PAN-1/scopes/active/x.json'], APPROVED)).toEqual(['src/b.ts']);
  });

  it('matches nothing with a glob entry', () => {
    const globbed = [{ ...APPROVED[0]!, fileScope: ['src/**/*.ts'] }];
    expect(outOfScopeFiles(['src/a.ts'], globbed)).toEqual(['src/a.ts']);
  });
});

describe('ApprovedScopeCheck', () => {
  it('lists files outside the approved scope', () => {
    state.value = golden;
    render(<ApprovedScopeCheck issueId="PAN-1" files={['src/a.ts', 'src/b.ts']} />);
    expect(screen.getByText('Outside approved scope:')).toBeInTheDocument();
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();
  });

  it('confirms when every file is in scope, and lists unchecked patterns', () => {
    state.value = { ...golden, approvedScopes: [{ ...APPROVED[0], fileScope: ['src/a.ts', 'lib/**'] }] };
    render(<ApprovedScopeCheck issueId="PAN-1" files={['src/a.ts']} />);
    expect(screen.getByText('All changed files are in the approved scope')).toBeInTheDocument();
    expect(screen.getByText('lib/**')).toBeInTheDocument();
  });

  it('renders nothing without approved scopes', () => {
    state.value = { ...golden, approvedScopes: [] };
    expect(render(<ApprovedScopeCheck issueId="PAN-1" files={['src/a.ts']} />).container.innerHTML).toBe('');
  });
});
