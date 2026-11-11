import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInScreen } from '../SignInScreen';

afterEach(() => cleanup());

describe('SignInScreen signed-out notice (PAN-5107)', () => {
  it("ac1: 'deletion-requested' shows the deletion-started message and no Delete on the web button", () => {
    render(<SignInScreen onSignIn={async () => {}} error={null} notice="deletion-requested" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Your account is being deleted.');
    expect(screen.queryByRole('button', { name: 'Delete on the web' })).toBeNull();
  });

  it("ac2: 'finish-on-web' shows the finish-on-web message and a Delete on the web button that calls onOpenAccountPage", () => {
    const onOpenAccountPage = vi.fn();
    render(<SignInScreen onSignIn={async () => {}} error={null} notice="finish-on-web" onOpenAccountPage={onOpenAccountPage} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('This phone is signed out. Finish deleting your account on the web.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete on the web' }));
    expect(onOpenAccountPage).toHaveBeenCalledTimes(1);
  });

  it('ac3: with no notice, no status element renders and Sign in still renders', () => {
    render(<SignInScreen onSignIn={async () => {}} error={null} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
