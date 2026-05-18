import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SwarmRuntimeSection } from '../InspectorPanel';

describe('SwarmRuntimeSection', () => {
  it('renders failed-merge slots with PR link, reason, and swarm failure banner', () => {
    const { container } = render(
      <SwarmRuntimeSection
        swarmState={{
          issueId: 'PAN-1194',
          lastAutoAdvanceError: 'Swarm slot 1 PR https://github.com/owner/repo/pull/1188 unmergeable',
          autoAdvanceFailureCount: 2,
          slots: [
            {
              slot: 1,
              itemId: 'mergeability-detector',
              itemTitle: 'Mergeability detector',
              sessionName: 'agent-pan-1194-1',
              workspace: '/tmp/feature-pan-1194-slot-1',
              status: 'failed-merge',
              phase: 'implementation',
              failureReason: 'PR #1188 not mergeable: CONFLICTING',
              prUrl: 'https://github.com/owner/repo/pull/1188',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Failed merge')).toBeInTheDocument();
    expect(screen.getByTestId('swarm-slot-failure-reason')).toHaveTextContent('PR #1188 not mergeable: CONFLICTING');
    expect(screen.getByTestId('swarm-failure-banner')).toHaveTextContent('Auto-advance failures: 2');
    expect(screen.getByRole('link', { name: /slot pr/i })).toHaveAttribute('href', 'https://github.com/owner/repo/pull/1188');
    expect(screen.getByRole('link', { name: /slot pr/i })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /slot pr/i })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container).toMatchSnapshot();
  });

  it('omits the PR link when failed-merge metadata has no prUrl', () => {
    render(
      <SwarmRuntimeSection
        swarmState={{
          issueId: 'PAN-1194',
          slots: [
            {
              slot: 1,
              itemId: 'mergeability-detector',
              itemTitle: 'Mergeability detector',
              sessionName: 'agent-pan-1194-1',
              workspace: '/tmp/feature-pan-1194-slot-1',
              status: 'failed-merge',
              phase: 'implementation',
              failureReason: 'No open PR found for feature/pan-1194-slot-1',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Failed merge')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /slot pr/i })).not.toBeInTheDocument();
  });
});
