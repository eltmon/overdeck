import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../alert-dialog';

describe('AlertDialog', () => {
  it('renders dialog content when open', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test Title</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>Test description</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <AlertDialog open={false}>
        <AlertDialogContent>
          <AlertDialogTitle>Hidden</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    );

    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('calls action handler on click', async () => {
    const user = userEvent.setup();
    const handleAction = vi.fn();

    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm Action</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAction}>Do it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    await user.click(screen.getByRole('button', { name: 'Do it' }));
    expect(handleAction).toHaveBeenCalledOnce();
  });

  it('calls cancel handler on click', async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();

    render(
      <AlertDialog open onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm Cancel</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogCancel>Nope</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    await user.click(screen.getByRole('button', { name: 'Nope' }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies destructive variant class to action button', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete Item</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogAction variant="destructive">Confirm Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    const btn = screen.getByRole('button', { name: 'Confirm Delete' });
    expect(btn.className).toContain('bg-red-600');
  });

  it('applies default variant class to action button', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Proceed</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogAction variant="default">Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    const btn = screen.getByRole('button', { name: 'Continue' });
    expect(btn.className).toContain('bg-blue-600');
  });

  it('uses project design tokens for styling', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Styled Dialog</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Dismiss</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    const title = screen.getByText('Styled Dialog');
    expect(title.className).toContain('text-content');

    const cancel = screen.getByRole('button', { name: 'Dismiss' });
    expect(cancel.className).toContain('bg-surface-overlay');
  });
});
