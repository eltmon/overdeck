/**
 * PAN-5364 FR-8: a run of identical voided rebuilds is one collapsed row that
 * expands into each batch's own older row.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OlderBatchRun } from '../OlderBatchRun';
import { gen, member, mockFetch, renderWithClient } from './fixtures';

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const RUN = [3, 2, 1].map((n) => gen({
  name: `uat/pan-train-moss-1115-${n}`, status: 'invalidated', members: [member('PAN-1'), member('PAN-2', 2)],
}));

describe('OlderBatchRun', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('collapses to one line naming the oldest and newest batch', () => {
    mockFetch({});
    renderWithClient(<OlderBatchRun gens={RUN} projectKey="overdeck" projectName="overdeck" />);
    expect(screen.getByTestId('older-batch-run-pan-train-moss-1115-3').textContent)
      .toContain('3 rebuilds voided, pan-train-moss-1115-1 to pan-train-moss-1115-3, same members');
    expect(screen.queryByTestId('older-batch-pan-train-moss-1115-2')).toBeNull();
  });

  it('show expands each batch into its own older row', () => {
    mockFetch({});
    renderWithClient(<OlderBatchRun gens={RUN} projectKey="overdeck" projectName="overdeck" />);
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    for (const n of [3, 2, 1]) expect(screen.getByTestId(`older-batch-pan-train-moss-1115-${n}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'hide' }));
    expect(screen.queryByTestId('older-batch-pan-train-moss-1115-2')).toBeNull();
  });
});
