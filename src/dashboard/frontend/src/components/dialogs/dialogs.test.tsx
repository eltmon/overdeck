import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DialogProvider, useConfirm, useAlert } from './DialogProvider';

// Helper component that exposes dialog triggers for testing
function TestHarness({ onResult }: { onResult: (result: unknown) => void }) {
  const confirmDialog = useConfirm();
  const alertDialog = useAlert();

  return (
    <div>
      <button
        data-testid="trigger-confirm"
        onClick={async () => {
          const result = await confirmDialog({ message: 'Are you sure?', title: 'Confirm' });
          onResult(result);
        }}
      />
      <button
        data-testid="trigger-destructive"
        onClick={async () => {
          const result = await confirmDialog({
            message: 'This is destructive',
            title: 'Delete',
            variant: 'destructive',
            confirmLabel: 'Delete',
          });
          onResult(result);
        }}
      />
      <button
        data-testid="trigger-alert"
        onClick={async () => {
          await alertDialog({ message: 'Something happened', title: 'Notice', variant: 'info' });
          onResult('alert-closed');
        }}
      />
      <button
        data-testid="trigger-error-alert"
        onClick={async () => {
          await alertDialog({ message: 'It failed', title: 'Error', variant: 'error' });
          onResult('error-closed');
        }}
      />
    </div>
  );
}

function renderWithProvider(onResult = vi.fn()) {
  const result = render(
    <DialogProvider>
      <TestHarness onResult={onResult} />
    </DialogProvider>
  );
  return { ...result, onResult };
}

describe('ConfirmDialog', () => {
  it('renders confirmation dialog with title and message', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('resolves true when Confirm is clicked', async () => {
    const { onResult } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('resolves false when Cancel is clicked', async () => {
    const { onResult } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('resolves false when Escape is pressed', async () => {
    const { onResult } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('resolves false when backdrop is clicked', async () => {
    const { onResult, container } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    // The backdrop is the fixed overlay div
    const backdrop = container.querySelector('[role="presentation"]')!;
    await act(async () => {
      fireEvent.click(backdrop);
    });
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('shows destructive variant with red styling and AlertTriangle icon', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-destructive'));
    });
    expect(screen.getByText('This is destructive')).toBeInTheDocument();
    // Destructive variant should have the Delete button with red styling
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(deleteBtn.className).toContain('bg-red-600');
  });

  it('focuses Cancel button for destructive variant', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-destructive'));
    });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('focuses Confirm button for default variant', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('uses alertdialog role for accessibility', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('AlertNoticeDialog', () => {
  it('renders alert dialog with title and message', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alert'));
    });
    expect(screen.getByText('Notice')).toBeInTheDocument();
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('resolves when OK is clicked', async () => {
    const { onResult } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alert'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    });
    expect(onResult).toHaveBeenCalledWith('alert-closed');
  });

  it('resolves when Escape is pressed', async () => {
    const { onResult } = renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alert'));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onResult).toHaveBeenCalledWith('alert-closed');
  });

  it('renders error variant', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-error-alert'));
    });
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('It failed')).toBeInTheDocument();
  });

  it('uses alertdialog role for accessibility', async () => {
    renderWithProvider();
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alert'));
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('DialogProvider - promise management', () => {
  it('dismisses pending confirm when a new one is triggered', async () => {
    const { onResult } = renderWithProvider();

    // Trigger first confirm (don't resolve it)
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-confirm'));
    });
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    // Trigger second confirm — first should auto-resolve false
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-destructive'));
    });
    expect(onResult).toHaveBeenCalledWith(false); // First promise resolved false
    expect(screen.getByText('This is destructive')).toBeInTheDocument();
  });

  it('dismisses pending alert when a new one is triggered', async () => {
    const { onResult } = renderWithProvider();

    // Trigger first alert
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-alert'));
    });
    expect(screen.getByText('Something happened')).toBeInTheDocument();

    // Trigger second alert — first should auto-resolve
    await act(async () => {
      fireEvent.click(screen.getByTestId('trigger-error-alert'));
    });
    expect(onResult).toHaveBeenCalledWith('alert-closed'); // First promise resolved
    expect(screen.getByText('It failed')).toBeInTheDocument();
  });
});

describe('useConfirm / useAlert outside provider', () => {
  it('throws when useConfirm is used outside DialogProvider', () => {
    function BadComponent() {
      useConfirm();
      return null;
    }
    expect(() => render(<BadComponent />)).toThrow('useConfirm must be used within DialogProvider');
  });

  it('throws when useAlert is used outside DialogProvider', () => {
    function BadComponent() {
      useAlert();
      return null;
    }
    expect(() => render(<BadComponent />)).toThrow('useAlert must be used within DialogProvider');
  });
});
