import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FacetPanel } from '../FacetPanel';

const EMPTY_FACETS = {
  models: [],
  workspaces: [],
  tags: [],
  tools: [],
  files: [],
  timeRanges: [],
  costRanges: [],
  enrichmentLevels: [],
};

describe('FacetPanel harness filter', () => {
  it('shows harness chips only when non-Claude rows exist and emits the selected harness', () => {
    const onChange = vi.fn();

    render(
      <FacetPanel
        filters={{}}
        facets={{
          ...EMPTY_FACETS,
          harnesses: [
            { value: 'claude-code', count: 2 },
            { value: 'codex', count: 1 },
          ],
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Harness')).toBeInTheDocument();
    fireEvent.click(screen.getByText('codex: 1'));
    expect(onChange).toHaveBeenCalledWith('harness', 'codex');
  });

  it('hides harness chips for Claude-only rows', () => {
    render(
      <FacetPanel
        filters={{}}
        facets={{
          ...EMPTY_FACETS,
          harnesses: [{ value: 'claude-code', count: 2 }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Harness')).not.toBeInTheDocument();
  });
});
