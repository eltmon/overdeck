import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { DialogProvider, useConfirm, useAlert } from './DialogProvider';

function TestConfirmComponent({ options, onResult }: {
  options: Parameters<ReturnType<typeof useConfirm>>[0];
  onResult: (v: boolean) => void;
}) {
  const confirm = useConfirm();
  return (
    <button onClick={async () => onResult(await confirm(options))}>
      Open Confirm
    </button>
  );
}

function TestAlertComponent({ options, onResult }: {
  options: Parameters<ReturnType<typeof useAlert>>[0];
  onResult: () => void;
}) {
  const alert = useAlert();
  return (
    <button onClick={async () => { await alert(options); onResult(); }}>
      Open Alert
    </button>
  );
}

describe('DialogProvider', () => {
  describe('useConfirm', () => {
    it('renders confirm dialog with title and message', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Delete Item', message: 'Are you sure?' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));

      expect(screen.getByText('Delete Item')).toBeInTheDocument();
      expect(screen.getByText('Are you sure?')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('resolves true when Confirm is clicked', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Test', message: 'Confirm?' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    });

    it('resolves false when Cancel is clicked', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Test', message: 'Confirm?' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));
      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });

    it('resolves false when Escape is pressed', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Test', message: 'Confirm?' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });

    it('uses custom button labels', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Test', message: 'Test?', confirmLabel: 'Delete', cancelLabel: 'Keep' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));

      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Keep')).toBeInTheDocument();
    });

    it('requires confirmation text when provided', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Reset', message: 'Reset?', confirmLabel: 'Reset issue', requiredText: 'Reset issue' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));
      const confirmButton = screen.getByRole('button', { name: 'Reset issue' });

      expect(confirmButton).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'Reset issue' } });
      fireEvent.click(confirmButton);

      await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    });

    it('focuses Cancel button for destructive variant', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Delete', message: 'This is destructive', variant: 'destructive', confirmLabel: 'Delete' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toHaveFocus();
      });
    });

    it('focuses Confirm button for default variant', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestConfirmComponent
            options={{ title: 'Start Agent', message: 'Start agent?', confirmLabel: 'Proceed' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Confirm'));

      await waitFor(() => {
        expect(screen.getByText('Proceed')).toHaveFocus();
      });
    });
  });

  describe('useAlert', () => {
    it('renders alert dialog with message and OK button', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestAlertComponent
            options={{ message: 'Operation succeeded', variant: 'success' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Alert'));

      expect(screen.getByText('Operation succeeded')).toBeInTheDocument();
      expect(screen.getByText('OK')).toBeInTheDocument();
      expect(screen.getByText('Success')).toBeInTheDocument();
    });

    it('resolves when OK is clicked', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestAlertComponent
            options={{ message: 'Done' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Alert'));
      fireEvent.click(screen.getByText('OK'));

      await waitFor(() => expect(onResult).toHaveBeenCalled());
    });

    it('resolves when Escape is pressed', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestAlertComponent
            options={{ message: 'Notice' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Alert'));
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => expect(onResult).toHaveBeenCalled());
    });

    it('shows error variant with Error title', async () => {
      const onResult = vi.fn();
      render(
        <DialogProvider>
          <TestAlertComponent
            options={{ message: 'Something broke', variant: 'error' }}
            onResult={onResult}
          />
        </DialogProvider>
      );

      fireEvent.click(screen.getByText('Open Alert'));
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('hook outside provider', () => {
    it('useConfirm throws when used outside DialogProvider', () => {
      expect(() => {
        renderHook(() => useConfirm());
      }).toThrow('useConfirm must be used within DialogProvider');
    });

    it('useAlert throws when used outside DialogProvider', () => {
      expect(() => {
        renderHook(() => useAlert());
      }).toThrow('useAlert must be used within DialogProvider');
    });
  });

  describe('promise leak prevention', () => {
    it('resolves previous dialog with false when new dialog is opened', async () => {
      const firstResult = vi.fn();
      const secondResult = vi.fn();

      function DoubleDialogComponent() {
        const confirm = useConfirm();
        return (
          <>
            <button onClick={async () => firstResult(await confirm({ title: 'First', message: 'First dialog' }))}>
              First
            </button>
            <button onClick={async () => secondResult(await confirm({ title: 'Second', message: 'Second dialog' }))}>
              Second
            </button>
          </>
        );
      }

      render(
        <DialogProvider>
          <DoubleDialogComponent />
        </DialogProvider>
      );

      // Open first dialog
      fireEvent.click(screen.getByText('First'));
      expect(screen.getByText('First dialog')).toBeInTheDocument();

      // Open second dialog while first is pending — should dismiss first
      fireEvent.click(screen.getByText('Second'));

      // First promise should resolve with false
      await waitFor(() => expect(firstResult).toHaveBeenCalledWith(false));

      // Second dialog should now be visible
      expect(screen.getByText('Second dialog')).toBeInTheDocument();

      // Confirm second dialog
      fireEvent.click(screen.getByText('Confirm'));
      await waitFor(() => expect(secondResult).toHaveBeenCalledWith(true));
    });
  });
});
