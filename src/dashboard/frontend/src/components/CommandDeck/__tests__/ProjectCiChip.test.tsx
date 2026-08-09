import { fireEvent, render, screen } from '@testing-library/react';
import type { ProjectCiSnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../lib/store';
import { ProjectCiChip } from '../ProjectCiChip';

const PROJECT_KEY = 'overdeck';

function record(overrides: Partial<ProjectCiSnapshot> = {}): ProjectCiSnapshot {
  return {
    projectKey: PROJECT_KEY,
    repo: 'eltmon/overdeck',
    branch: 'main',
    headSha: '0123456789abcdef',
    suites: {
      '101': {
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/101',
      },
    },
    updatedAt: '2026-08-04T08:10:00.000Z',
    ...overrides,
  };
}

function seed(projectCi: ProjectCiSnapshot) {
  useDashboardStore.setState({
    ciByProjectKey: { [PROJECT_KEY]: projectCi },
  });
}

describe('ProjectCiChip', () => {
  beforeEach(() => {
    useDashboardStore.setState({ ciByProjectKey: {} });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when the project has no CI record', () => {
    const { container } = render(<ProjectCiChip projectKey={PROJECT_KEY} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the authoritative head has no Actions suites', () => {
    seed(record({ suites: {} }));
    const { container } = render(<ProjectCiChip projectKey={PROJECT_KEY} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    {
      name: 'queued',
      suites: {
        '101': { status: 'completed', conclusion: 'success' },
        '102': { status: 'queued', conclusion: null },
      },
      label: 'CI 1/2',
      color: 'var(--muted-foreground)',
    },
    {
      name: 'in_progress',
      suites: {
        '101': { status: 'completed', conclusion: 'success' },
        '102': { status: 'in_progress', conclusion: null },
      },
      label: 'CI 1/2',
      color: 'var(--info)',
    },
    {
      name: 'success',
      suites: {
        '101': { status: 'completed', conclusion: 'success' },
        '102': { status: 'completed', conclusion: 'success' },
      },
      label: 'CI',
      color: 'var(--muted-foreground)',
    },
    {
      name: 'failure',
      suites: {
        '101': { status: 'completed', conclusion: 'failure' },
        '102': { status: 'in_progress', conclusion: null },
      },
      label: 'CI ✗',
      color: 'var(--destructive)',
    },
  ])('renders the $name state', ({ name, suites, label, color }) => {
    seed(record({ suites }));

    render(<ProjectCiChip projectKey={PROJECT_KEY} />);

    const chip = screen.getByTestId('project-ci-chip');
    expect(chip).toHaveAttribute('data-ci-state', name);
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('style', `color: ${color};`);
  });

  it('opens a single workflow run and stops the project-row click', () => {
    seed(record());
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <ProjectCiChip projectKey={PROJECT_KEY} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('project-ci-chip'));

    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/eltmon/overdeck/actions/runs/101',
      '_blank',
      'noopener,noreferrer',
    );
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('opens commit checks for multiple workflows from Enter and Space', () => {
    seed(record({
      suites: {
        '101': {
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/101',
        },
        '102': {
          status: 'queued',
          conclusion: null,
          htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/102',
        },
      },
    }));
    const parentKeyDown = vi.fn();

    render(
      <div onKeyDown={parentKeyDown}>
        <ProjectCiChip projectKey={PROJECT_KEY} />
      </div>,
    );
    const chip = screen.getByTestId('project-ci-chip');
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });

    expect(window.open).toHaveBeenCalledTimes(2);
    expect(window.open).toHaveBeenNthCalledWith(
      1,
      'https://github.com/eltmon/overdeck/commit/0123456789abcdef/checks',
      '_blank',
      'noopener,noreferrer',
    );
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});
