/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider, useConfirmDialog } from './ConfirmDialogProvider';

// Test component that triggers confirm dialog
function TestConsumer({ onResult }: { onResult: (result: boolean) => void }) {
  const { confirm } = useConfirmDialog();

  return (
    <button
      onClick={async () => {
        const result = await confirm({
          title: 'Test Title',
          message: 'Are you sure?',
          confirmLabel: 'Yes',
          cancelLabel: 'No',
          variant: 'danger',
        });
        onResult(result);
      }}
    >
      Open Dialog
    </button>
  );
}

function renderWithProvider(onResult: (result: boolean) => void) {
  return render(
    <ConfirmDialogProvider>
      <TestConsumer onResult={onResult} />
    </ConfirmDialogProvider>
  );
}

describe('ConfirmDialogProvider', () => {
  it('renders children without dialog initially', () => {
    const onResult = vi.fn();
    renderWithProvider(onResult);
    expect(screen.getByText('Open Dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows dialog when confirm() is called', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('resolves true when confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));
    await user.click(screen.getByText('Yes'));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));
    await user.click(screen.getByText('No'));

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));
    await user.keyboard('{Escape}');

    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when overlay is clicked', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));
    // Click the overlay (role="presentation")
    const overlay = screen.getByRole('presentation');
    await user.click(overlay);

    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('does not close when dialog body is clicked', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    renderWithProvider(onResult);

    await user.click(screen.getByText('Open Dialog'));
    await user.click(screen.getByText('Are you sure?'));

    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('resolves previous promise as false when confirm() called while pending', async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];

    function DoubleConsumer() {
      const { confirm } = useConfirmDialog();
      return (
        <>
          <button data-testid="btn-first" onClick={async () => { results.push(await confirm({ message: 'First dialog message' })); }}>Open First</button>
          <button data-testid="btn-second" onClick={async () => { results.push(await confirm({ message: 'Second dialog message' })); }}>Open Second</button>
        </>
      );
    }

    render(
      <ConfirmDialogProvider>
        <DoubleConsumer />
      </ConfirmDialogProvider>
    );

    // Open first dialog
    await user.click(screen.getByTestId('btn-first'));
    expect(screen.getByText('First dialog message')).toBeInTheDocument();

    // Open second dialog before resolving first — first should resolve false
    await user.click(screen.getByTestId('btn-second'));

    // First promise should have resolved false
    expect(results).toContain(false);

    // Second dialog should now be showing
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Second dialog message')).toBeInTheDocument();
  });

  it('uses default variant and labels when not specified', async () => {
    const user = userEvent.setup();

    function MinimalConsumer() {
      const { confirm } = useConfirmDialog();
      return (
        <button onClick={() => confirm({ message: 'Simple message' })}>
          Open
        </button>
      );
    }

    render(
      <ConfirmDialogProvider>
        <MinimalConsumer />
      </ConfirmDialogProvider>
    );

    await user.click(screen.getByText('Open'));

    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('renders multi-line messages with bullet points', async () => {
    const user = userEvent.setup();

    function MultiLineConsumer() {
      const { confirm } = useConfirmDialog();
      return (
        <button onClick={() => confirm({ message: 'This will:\n• Delete files\n• Remove branches' })}>
          Open
        </button>
      );
    }

    render(
      <ConfirmDialogProvider>
        <MultiLineConsumer />
      </ConfirmDialogProvider>
    );

    await user.click(screen.getByText('Open'));

    expect(screen.getByText(/Delete files/)).toBeInTheDocument();
    expect(screen.getByText(/Remove branches/)).toBeInTheDocument();
  });

  it('throws when useConfirmDialog is used outside provider', () => {
    function Orphan() {
      useConfirmDialog();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      'useConfirmDialog must be used within ConfirmDialogProvider'
    );
  });
});
