import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider, useConfirmDialog } from '../useConfirmDialog';

function TestHarness({ onReady }: { onReady: (api: ReturnType<typeof useConfirmDialog>) => void }) {
  const api = useConfirmDialog();
  onReady(api);
  return null;
}

function renderWithProvider() {
  let api!: ReturnType<typeof useConfirmDialog>;
  render(
    <ConfirmDialogProvider>
      <TestHarness onReady={(a) => { api = a; }} />
    </ConfirmDialogProvider>
  );
  return api;
}

describe('useConfirmDialog', () => {
  it('throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestHarness onReady={() => {}} />)).toThrow(
      'useConfirmDialog must be used within ConfirmDialogProvider'
    );
    spy.mockRestore();
  });

  describe('confirm()', () => {
    it('resolves true when action button clicked', async () => {
      const user = userEvent.setup();
      const api = renderWithProvider();

      let result: boolean | undefined;
      act(() => {
        api.confirm({
          title: 'Delete item?',
          description: 'This cannot be undone.',
          confirmLabel: 'Delete',
        }).then((v) => { result = v; });
      });

      await waitFor(() => expect(screen.getByText('Delete item?')).toBeInTheDocument());
      expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(result).toBe(true));
    });

    it('resolves false when cancel button clicked', async () => {
      const user = userEvent.setup();
      const api = renderWithProvider();

      let result: boolean | undefined;
      act(() => {
        api.confirm({
          title: 'Confirm action?',
          description: 'Are you sure?',
        }).then((v) => { result = v; });
      });

      await waitFor(() => expect(screen.getByText('Confirm action?')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(result).toBe(false));
    });

    it('shows destructive variant styling', async () => {
      const api = renderWithProvider();

      act(() => {
        api.confirm({
          title: 'Danger zone',
          description: 'Destructive action.',
          confirmLabel: 'Destroy',
          variant: 'destructive',
        });
      });

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: 'Destroy' });
        expect(btn.className).toContain('bg-red-600');
      });
    });
  });

  describe('alert()', () => {
    it('resolves when OK clicked (no cancel button)', async () => {
      const user = userEvent.setup();
      const api = renderWithProvider();

      let resolved = false;
      act(() => {
        api.alert({
          title: 'Notice',
          description: 'Something happened.',
          confirmLabel: 'OK',
        }).then(() => { resolved = true; });
      });

      await waitFor(() => expect(screen.getByText('Notice')).toBeInTheDocument());
      // Alert should not have a Cancel button
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'OK' }));
      await waitFor(() => expect(resolved).toBe(true));
    });
  });

  describe('prompt()', () => {
    it('resolves with entered text on confirm', async () => {
      const user = userEvent.setup();
      const api = renderWithProvider();

      let result: string | null | undefined;
      act(() => {
        api.prompt({
          title: 'Enter name',
          description: 'Provide a name.',
          confirmLabel: 'Submit',
          placeholder: 'Name here',
          defaultValue: '',
        }).then((v) => { result = v; });
      });

      await waitFor(() => expect(screen.getByPlaceholderText('Name here')).toBeInTheDocument());
      await user.type(screen.getByPlaceholderText('Name here'), 'hello');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await waitFor(() => expect(result).toBe('hello'));
    });

    it('resolves null on cancel', async () => {
      const user = userEvent.setup();
      const api = renderWithProvider();

      let result: string | null | undefined = 'not-set';
      act(() => {
        api.prompt({
          title: 'Enter value',
          description: 'Provide a value.',
          confirmLabel: 'Submit',
        }).then((v) => { result = v; });
      });

      await waitFor(() => expect(screen.getByText('Enter value')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(result).toBeNull());
    });
  });

  describe('promise leak prevention', () => {
    it('resolves first dialog with false when second dialog opens', async () => {
      const api = renderWithProvider();

      let firstResult: boolean | undefined;

      act(() => {
        api.confirm({ title: 'First dialog', description: 'First.' })
          .then((v) => { firstResult = v; });
      });

      await waitFor(() => expect(screen.getByText('First dialog')).toBeInTheDocument());

      act(() => {
        api.confirm({ title: 'Second dialog', description: 'Second.' });
      });

      // First promise should have been resolved with false (dismissed)
      await waitFor(() => expect(firstResult).toBe(false));
      // Second dialog should now be showing
      await waitFor(() => expect(screen.getByText('Second dialog')).toBeInTheDocument());
    });
  });
});
