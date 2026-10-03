/** PAN-4486 WI-9: the linked-issue picker of the options dialog. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDashboardStore } from '../../../lib/store';
import { IssuePickerField } from '../IssuePickerField';

function issue(identifier: string, title: string) {
  return { id: identifier, identifier, title, status: 'Todo', priority: 0, labels: [] };
}

beforeEach(() => {
  useDashboardStore.setState({
    issuesRaw: [
      issue('PAN-4486', 'New conversation split button'),
      issue('PAN-4254', 'Effort levels at creation'),
      issue('MIN-12', 'Unrelated'),
    ],
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('IssuePickerField', () => {
  it('filters by identifier and selects with a click', () => {
    const onChange = vi.fn();
    render(<IssuePickerField value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Link to an issue' }), { target: { value: '4486' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('PAN-4486');
    fireEvent.mouseDown(options[0]!);
    expect(onChange).toHaveBeenCalledWith('PAN-4486');
  });

  it('filters by title and selects with Enter', () => {
    const onChange = vi.fn();
    render(<IssuePickerField value={null} onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Link to an issue' });
    fireEvent.change(input, { target: { value: 'effort' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('PAN-4254');
  });

  it('closes the list on Escape', () => {
    render(<IssuePickerField value={null} onChange={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Link to an issue' });
    fireEvent.change(input, { target: { value: 'PAN' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the selection and clears it', () => {
    const onChange = vi.fn();
    render(<IssuePickerField value="PAN-4486" onChange={onChange} />);
    expect(screen.getByText('PAN-4486 — New conversation split button')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear linked issue' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
