import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/dashboard/frontend/src/lib/telemetry', () => ({
  captureException: captureExceptionMock,
}));

import { PhoneErrorBoundary } from '../MachineView';

function Thrower(): never {
  throw new Error('boom');
}

describe('PhoneErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('captures the exception once with the frontend_unhandled_error action', () => {
    render(
      <PhoneErrorBoundary>
        <Thrower />
      </PhoneErrorBoundary>,
    );

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      action: 'frontend_unhandled_error',
      trigger: 'root_error_boundary',
    });
  });

  it('renders the fallback message and a Reload button', () => {
    render(
      <PhoneErrorBoundary>
        <Thrower />
      </PhoneErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong on this screen.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('still renders the fallback when captureException throws', () => {
    captureExceptionMock.mockImplementation(() => { throw new Error('telemetry blew up'); });

    render(
      <PhoneErrorBoundary>
        <Thrower />
      </PhoneErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('renders children when nothing throws', () => {
    render(
      <PhoneErrorBoundary>
        <p>all good</p>
      </PhoneErrorBoundary>,
    );

    expect(screen.getByText('all good')).toBeTruthy();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
