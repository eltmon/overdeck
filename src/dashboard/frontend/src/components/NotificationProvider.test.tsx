/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationProvider, useNotification } from './NotificationProvider';

function TestConsumer({ type = 'info' as const, message = 'Test message', title, duration }: {
  type?: 'success' | 'error' | 'warning' | 'info';
  message?: string;
  title?: string;
  duration?: number;
}) {
  const { notify } = useNotification();
  return (
    <button onClick={() => notify({ type, message, title, duration })}>
      Notify
    </button>
  );
}

function renderWithProvider(props?: Parameters<typeof TestConsumer>[0]) {
  return render(
    <NotificationProvider>
      <TestConsumer {...props} />
    </NotificationProvider>
  );
}

describe('NotificationProvider', () => {
  it('renders children without notifications initially', () => {
    renderWithProvider();
    expect(screen.getByText('Notify')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows notification when notify() is called', async () => {
    const user = userEvent.setup();
    renderWithProvider({ message: 'Something happened' });

    await user.click(screen.getByText('Notify'));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('shows notification with title', async () => {
    const user = userEvent.setup();
    renderWithProvider({ message: 'Details here', title: 'Alert Title' });

    await user.click(screen.getByText('Notify'));

    expect(screen.getByText('Alert Title')).toBeInTheDocument();
    expect(screen.getByText('Details here')).toBeInTheDocument();
  });

  it('dismisses notification when X button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider({ message: 'Dismissable' });

    await user.click(screen.getByText('Notify'));
    expect(screen.getByText('Dismissable')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Dismissable')).not.toBeInTheDocument();
  });

  it('auto-dismisses after duration', async () => {
    vi.useFakeTimers();

    render(
      <NotificationProvider>
        <TestConsumer message="Auto-dismiss" duration={1000} />
      </NotificationProvider>
    );

    // Click using fireEvent since fake timers conflict with userEvent
    await act(async () => {
      screen.getByText('Notify').click();
    });
    expect(screen.getByText('Auto-dismiss')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByText('Auto-dismiss')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('supports multiple concurrent notifications', async () => {
    vi.useFakeTimers();

    function MultiConsumer() {
      const { notify } = useNotification();
      return (
        <>
          <button onClick={() => notify({ type: 'success', message: 'Success!', duration: 60000 })}>S</button>
          <button onClick={() => notify({ type: 'error', message: 'Error!', duration: 60000 })}>E</button>
        </>
      );
    }

    render(
      <NotificationProvider>
        <MultiConsumer />
      </NotificationProvider>
    );

    await act(async () => { screen.getByText('S').click(); });
    await act(async () => { screen.getByText('E').click(); });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(screen.getByText('Success!')).toBeInTheDocument();
    expect(screen.getByText('Error!')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('throws when useNotification is used outside provider', () => {
    function Orphan() {
      useNotification();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      'useNotification must be used within NotificationProvider'
    );
  });
});
