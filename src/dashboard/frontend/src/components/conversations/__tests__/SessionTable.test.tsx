import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionTable } from '../SessionTable';

const BASE_SESSION = {
  id: 1,
  source: 'discovered' as const,
  harness: 'claude-code',
  workspacePath: '/home/user/Projects/alpha',
  jsonlPath: '/fake/1.jsonl',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 5,
  lastTs: '2025-01-01T01:00:00Z',
  estimatedCost: 0,
  tags: [],
  summary: null,
  conversationTitle: null,
  enrichmentLevel: 0 as const,
  enrichmentFailed: false,
  overdeckManaged: false,
  panIssueId: null,
};

describe('SessionTable harness badge', () => {
  it('badges non-Claude harness rows without showing a Claude badge', () => {
    render(
      <SessionTable
        selectedId={null}
        onSelect={vi.fn()}
        sessions={[
          { ...BASE_SESSION, id: 1 },
          { ...BASE_SESSION, id: 2, harness: 'codex', workspacePath: '/home/user/Projects/codex' },
        ]}
      />,
    );

    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.queryByText('claude-code')).not.toBeInTheDocument();
  });
});
