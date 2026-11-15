/**
 * PAN-4753 WI-10 (FR-7): an older batch is one collapsed line that expands
 * to the full card; it is never hidden.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OlderBatchRow } from '../OlderBatchRow';
import { gen } from './fixtures';

describe('OlderBatchRow', () => {
  it('is collapsed by default and expands to the card', () => {
    render(
      <OlderBatchRow gen={gen({ name: 'uat/min-otter-1101-3', status: 'invalidated' })}>
        <div data-testid="the-card">card</div>
      </OlderBatchRow>,
    );
    const row = screen.getByTestId('older-batch-min-otter-1101-3');
    expect(row.textContent).toContain('Older batch');
    expect(row.textContent).toContain('min-otter-1101-3');
    expect(row.textContent).toContain('voided');
    expect(screen.queryByTestId('the-card')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByTestId('the-card')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'hide older batch' }));
    expect(screen.queryByTestId('the-card')).toBeNull();
  });

  it('names a superseded batch as superseded', () => {
    render(
      <OlderBatchRow gen={gen({ name: 'uat/x-1', status: 'superseded' })}>
        <div />
      </OlderBatchRow>,
    );
    expect(screen.getByTestId('older-batch-x-1').textContent).toContain('superseded');
  });
});
